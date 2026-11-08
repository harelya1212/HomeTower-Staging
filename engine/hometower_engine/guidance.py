"""Guidance layer - SPEC45 sections 16, 17, 20 and 39+42.

- Sec. 16 Smart Document Request Engine: the household profile determines
  which documents the app asks for. Never the full fixed set for everyone.
- Sec. 17 Intelligent payroll shortcut: three no-change questions instead
  of demanding a new payslip every cycle. All-unchanged marks payroll
  PROVISIONALLY unchanged; a full document verification is still required
  every MAX_PROVISIONAL_CYCLES cycles, and immediately when anything
  changed or is unsure.
- Sec. 20 Annual Planning Cycle: the year's planning phases (January
  reset ... December Final Tax Lock) as a reminder layer.
- Sec. 39+42 The one NEXT ACTION: a single recommended action in the
  section 42 format - action / why / expected benefit / trade-off /
  confidence / what could change the answer.
"""
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from .freshness import document_freshness
from .intake import HouseholdIntake

MAX_PROVISIONAL_CYCLES = 2  # the 3rd cycle in a row requires the document


@dataclass
class ProfileExtras:
    """Household signals the app layer knows from the My House tables
    (assets and family) that the tax intake itself does not carry."""
    has_hsa: bool = False
    has_brokerage: bool = False
    has_rental: bool = False
    has_college_student: bool = False


@dataclass
class DocRequest:
    key: str
    category: str
    doc_type: str
    label: str
    detail: str
    status: str  # satisfied | stale | missing


def _doc_status(h: HouseholdIntake, doc_type: str, today: date) -> str:
    parsed = [d for d in h.documents if d.doc_type == doc_type and d.status == "parsed"]
    if not parsed:
        return "missing"
    dated = [d for d in parsed if d.captured_on is not None]
    if not dated:
        return "satisfied"
    latest = max(dated, key=lambda d: d.captured_on)
    return "stale" if document_freshness(latest, today).status == "stale" else "satisfied"


def _calibration_complete(h: HouseholdIntake) -> bool:
    c = h.calibration
    return bool(c and c.federal_filed and c.actual_federal_refund_owe is not None and c.outcome_verified)


def document_requests(h: HouseholdIntake, extras: ProfileExtras, today: date) -> list[DocRequest]:
    """SPEC45 sec. 16: the profile determines the request list."""
    reqs: list[DocRequest] = []

    def add(key: str, category: str, doc_type: str, label: str, detail: str,
            status: Optional[str] = None) -> None:
        reqs.append(DocRequest(key, category, doc_type, label, detail,
                               status if status is not None else _doc_status(h, doc_type, today)))

    # The calibration anchor is standing for every household: last year's
    # return as filed, plus the actual outcome the authority reported.
    add("prior_return", "calibration", "prior_return", "Last year's filed tax return",
        "The federal and state return exactly as filed - the calibration anchor for every forecast.")
    add("calibration_outcome", "calibration", "prior_return",
        "Last year's actual outcome",
        "The real refund you received or amount you owed, as the IRS and the state confirmed it.",
        status="satisfied" if _calibration_complete(h) else "missing")

    employed = any(m.role == "adult" for m in h.members)
    if employed:
        add("payslip", "w2_employee", "payslip", "Latest payslip",
            "The most recent pay stub for each working adult - it drives the whole tax forecast.")
        add("w2", "w2_employee", "w2", "W-2 (when available)",
            "Issued by the employer each January for the year that just ended.")

    if extras.has_brokerage:
        add("brokerage", "brokerage_investor", "brokerage_statement", "Latest brokerage statement",
            "Must show positions, realized gains/losses and tax lots - TaxImpact reads the lots.")

    if h.has_rsu or h.has_espp:
        add("stock_plan", "rsu_employee", "other", "Stock-plan statement",
            "The vest schedule and latest statement from the employer's stock plan (RSU / ESPP).")

    if extras.has_hsa:
        add("hsa_statement", "hsa_household", "hsa_statement", "HSA statement",
            "Latest statement from the HSA provider.")
        add("hsa_election", "hsa_household", "other", "Current HSA contribution election",
            "What you elected to contribute this year - a screenshot of the benefits page is enough.")

    if extras.has_college_student:
        add("529", "college_student", "529_statement", "529 statement",
            "Latest statement for the student's education account.")
        add("1098t", "college_student", "1098t", "1098-T (when available)",
            "The tuition statement the college issues each January.")
        add("1099q", "college_student", "1099q", "1099-Q (when available)",
            "Issued when money was withdrawn from the 529 during the year.")
        add("bursar", "college_student", "other", "Bursar ledger + scholarship information",
            "The college billing ledger and any scholarship terms - needed to coordinate 529 money with education credits.")

    if extras.has_rental:
        add("rental_pack", "rental_owner", "other", "Rental property pack",
            "Mortgage statement, rental income and expenses, property tax bill, and last year's Schedule E.")

    return reqs


@dataclass
class PayrollShortcutResult:
    provisional: bool
    needs_document: bool
    reason: str
    consecutive_after: int


def payroll_shortcut(gross_changed: str, net_changed: str, benefits_changed: str,
                     consecutive_provisional: int) -> PayrollShortcutResult:
    """SPEC45 sec. 17. Answers are 'no' | 'yes' | 'unsure'."""
    changed = [name for name, a in (("gross pay", gross_changed), ("net deposit", net_changed),
                                    ("benefit election", benefits_changed)) if a != "no"]
    if changed:
        return PayrollShortcutResult(
            False, True,
            f"{', '.join(changed)} changed or is unsure - a new payslip is needed to keep the forecast honest.",
            0)
    if consecutive_provisional >= MAX_PROVISIONAL_CYCLES:
        return PayrollShortcutResult(
            False, True,
            "Two provisional confirmations in a row - this cycle needs the actual payslip for full verification.",
            consecutive_provisional)
    return PayrollShortcutResult(
        True, False,
        "Nothing changed - payroll marked provisionally unchanged for this cycle.",
        consecutive_provisional + 1)


@dataclass
class AnnualPhase:
    key: str
    title: str
    items: list[str] = field(default_factory=list)


_PHASES = [
    (1, "january_reset", "January - Financial Reset",
     ["New federal tax rules", "New state rules", "Review the W-4", "Review state withholding",
      "Set 401(k) elections", "Set HSA elections", "Refresh retirement assumptions", "Set this year's goals"]),
    (2, "quarterly_check", "Quarterly - Financial Health Check",
     ["Bonuses", "RSU events", "ESPP events", "Investment gains", "Tax trajectory", "Retirement progress"]),
    (4, "quarterly_check", "Quarterly - Financial Health Check",
     ["Bonuses", "RSU events", "ESPP events", "Investment gains", "Tax trajectory", "Retirement progress"]),
    (6, "june_review", "June - Mid-Year Review",
     ["Withholding check", "HSA pace", "401(k) pace", "Dependent changes", "529 contributions",
      "Retirement pace", "Brokerage review"]),
    (7, "quarterly_check", "Quarterly - Financial Health Check",
     ["Bonuses", "RSU events", "ESPP events", "Investment gains", "Tax trajectory", "Retirement progress"]),
    (9, "landing_forecast", "September / October - Landing Forecast",
     ["Benefits enrollment", "Next year's HSA", "Health insurance choice", "Tax landing position",
      "Education funding"]),
    (11, "november_window", "November - Final Optimization Window",
     ["W-4 adjustments", "State withholding", "Capital gain harvesting", "Tax-loss harvesting",
      "Roth conversion", "Charitable giving", "Retirement contribution limits"]),
    (12, "december_lock", "December - Final Tax Lock",
     ["Know the approximate tax outcome BEFORE December 31", "No April surprises"]),
]


def annual_focus(month: int) -> AnnualPhase:
    """SPEC45 sec. 20: which phase of the annual cycle a month belongs to."""
    best: Optional[AnnualPhase] = None
    for start, key, title, items in _PHASES:
        if month >= start:
            best = AnnualPhase(key, title, list(items))
    if best is None:
        start, key, title, items = _PHASES[0]
        best = AnnualPhase(key, title, list(items))
    return best


def next_phase_start(month: int) -> tuple[int, str]:
    """(month, title) of the NEXT phase after the given month (wraps to January)."""
    starts = [(s, t) for s, _, t, _ in _PHASES]
    for s, t in starts:
        if s > month:
            return s, t
    return starts[0]


@dataclass
class NextActionInput:
    calibration_missing: bool
    verification_due: bool  # payroll shortcut says the real payslip is due
    stale_docs: list[str] = field(default_factory=list)  # labels, stalest first
    missing_request_label: Optional[str] = None  # top missing profile-driven request
    federal_position: Optional[str] = None  # below | inside | above (vs target band)
    federal_delta: float = 0.0  # dollars outside the band (positive amount)
    aging_docs: list[str] = field(default_factory=list)
    annual_phase_title: str = ""
    confidence_band: str = "Low"
    confidence_score: int = 0


@dataclass
class NextAction:
    action: str
    why: str
    expected_benefit: str
    trade_off: str
    confidence: str
    what_could_change: str


def _money(x: float) -> str:
    return f"${x:,.0f}"


def next_action(i: NextActionInput) -> NextAction:
    """SPEC45 sec. 39+42: exactly one best next action, sec. 42 format."""
    conf = f"{i.confidence_band} ({i.confidence_score}/100)"
    if i.verification_due:
        return NextAction(
            "Upload the latest payslip",
            "The payroll shortcut has used its provisional confirmations - this cycle needs the real document to stay verified.",
            "Keeps the tax forecast at decision grade instead of drifting on assumptions.",
            "About two minutes to upload a photo or file.",
            conf,
            "Nothing - verification is due regardless; the forecast re-checks itself right after.")
    if i.calibration_missing:
        return NextAction(
            "Add last year's filed return and its actual outcome",
            "Calibration is the anchor of the whole forecast: what you filed last year and what the IRS and state actually did with it.",
            "The single largest confidence gain available - worth up to 20 of the 100 confidence points.",
            "One-time effort; HomeTower asks only until it is recorded.",
            conf,
            "Once recorded, the top action moves to whatever is stale or off-target.")
    if i.stale_docs:
        return NextAction(
            f"Update the {i.stale_docs[0]}",
            "It is past its freshness window, so the forecast is running on old numbers for it.",
            "Restores that part of the forecast to current data and lifts the confidence score.",
            "About two minutes to upload the newer document.",
            conf,
            "A newer document changes the numbers it feeds - the forecast recomputes immediately.")
    if i.federal_position == "below":
        return NextAction(
            "Increase federal withholding (or set aside the difference)",
            f"The forecast lands {_money(i.federal_delta)} below your refund target band.",
            f"Closes a {_money(i.federal_delta)} gap before December, while there are still pay cycles left to spread it over.",
            "Slightly smaller take-home pay for the rest of the year.",
            conf,
            "A bonus, an RSU vest or a deduction change would move the forecast - recheck after any of them.")
    if i.federal_position == "above":
        return NextAction(
            "Consider reducing federal withholding",
            f"The forecast lands {_money(i.federal_delta)} above your refund target band - that is an interest-free loan to the IRS (SPEC45 sec. 22: never maximize a refund blindly).",
            f"Frees roughly {_money(i.federal_delta)} of cash flow across the remaining pay cycles instead of next spring.",
            "A smaller refund next spring - by design, not by surprise.",
            conf,
            "If you prefer the forced-savings effect of a big refund, keep the target band as it is.")
    if i.missing_request_label:
        return NextAction(
            f"Add the {i.missing_request_label}",
            "Your household profile asks for it - it feeds a part of the forecast that is currently estimated.",
            "Replaces an estimate with a document fact and lifts the confidence score.",
            "About two minutes to upload a photo or file.",
            conf,
            "Nothing structural - each document you add narrows what is still estimated.")
    if i.aging_docs:
        return NextAction(
            f"Refresh the {i.aging_docs[0]} soon",
            "It is inside the last days of its freshness window.",
            "Avoids a stale-data flag and a confidence drop next week.",
            "About two minutes when the new statement is available.",
            conf,
            "If no newer statement exists yet, this simply waits - the window is a warning, not an error.")
    return NextAction(
        "You're on track - review this month's snapshot",
        f"Nothing is stale, missing or off target. Current phase: {i.annual_phase_title}.",
        "A two-minute review keeps the household record - and the forecast - honest.",
        "None.",
        conf,
        "Any new document, job change or market move reopens the action list.")
