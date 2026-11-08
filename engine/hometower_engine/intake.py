"""Household intake model, validation, and the derived accuracy level.

Per INTAKE_DESIGN.md: the intake page asks the minimum for Level X first;
every parsed document unlocks more. The accuracy level is DERIVED from
what has actually been provided - never self-declared - and caps at X++
(X+++ filing grade comes only from final official forms at filing time).
"""
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

FILING_STATUSES = {"single", "married_filing_jointly", "married_filing_separately", "head_of_household"}
MEMBER_ROLES = {"adult", "dependent", "student"}
PAY_FREQUENCIES = {"weekly", "biweekly", "semimonthly", "monthly"}
DOCUMENT_TYPES = {"w2", "payslip", "hsa_statement", "401k_statement", "1099b", "1098t", "1099q",
                  "prior_return", "529_statement", "brokerage_statement", "pension_statement", "other"}
DOCUMENT_STATUSES = {"parsed", "pending_verify", "rejected"}


@dataclass
class Member:
    name: str
    role: str = "adult"
    date_of_birth: Optional[date] = None
    pay_frequency: Optional[str] = None


@dataclass
class DocumentRecord:
    doc_type: str
    status: str  # parsed | pending_verify | rejected
    confidence: float = 0.0
    captured_on: Optional[date] = None  # freshness is computed from this
    fields: Optional[dict] = None  # extracted values kept so My House rows can pre-fill


@dataclass
class CalibrationRecord:
    """Last year's FILED returns and what the authorities actually said.

    The calibration anchor (owner requirement, 2026-11-07): the prior
    return as filed to the IRS and the state, verified against the real
    outcome (actual refund or actual amount owed). The basic plan always
    asks for it; when it is missing, the app keeps asking.
    """
    tax_year: int
    federal_filed: bool = False
    state_filed: bool = False
    actual_federal_refund_owe: Optional[float] = None  # + refund, - owed
    actual_state_refund_owe: Optional[float] = None
    outcome_verified: bool = False  # checked against the IRS/state outcome


@dataclass
class HouseholdIntake:
    name: str
    state: str
    filing_status: str
    members: list[Member] = field(default_factory=list)
    refund_target_low: Optional[float] = None
    refund_target_high: Optional[float] = None
    documents: list[DocumentRecord] = field(default_factory=list)
    has_rsu: bool = False
    has_espp: bool = False
    has_foreign_accounts_or_income: bool = False
    ytd_payroll_known: bool = False
    capital_loss_carryforward_known: bool = False
    calibration: Optional[CalibrationRecord] = None


def validate(h: HouseholdIntake) -> list[str]:
    errors: list[str] = []
    if not h.name.strip():
        errors.append("household name is required")
    if len(h.state) != 2 or not h.state.isalpha() or h.state != h.state.upper():
        errors.append("state must be a 2-letter uppercase code")
    if h.filing_status not in FILING_STATUSES:
        errors.append(f"filing_status must be one of {sorted(FILING_STATUSES)}")
    if not h.members:
        errors.append("at least one member is required")
    for m in h.members:
        if m.role not in MEMBER_ROLES:
            errors.append(f"member {m.name}: role must be one of {sorted(MEMBER_ROLES)}")
        if m.pay_frequency is not None and m.pay_frequency not in PAY_FREQUENCIES:
            errors.append(f"member {m.name}: unknown pay_frequency {m.pay_frequency}")
    if (h.refund_target_low is None) != (h.refund_target_high is None):
        errors.append("refund target needs both low and high")
    if h.refund_target_low is not None and h.refund_target_high is not None:
        if h.refund_target_low > h.refund_target_high:
            errors.append("refund target low must be <= high")
    for d in h.documents:
        if d.doc_type not in DOCUMENT_TYPES:
            errors.append(f"unknown document type {d.doc_type}")
        if d.status not in DOCUMENT_STATUSES:
            errors.append(f"document {d.doc_type}: unknown status {d.status}")
    return errors


def _parsed(h: HouseholdIntake, doc_type: str) -> bool:
    return any(d.doc_type == doc_type and d.status == "parsed" for d in h.documents)


def accuracy_level(h: HouseholdIntake) -> str:
    """Derived accuracy level: X, X+ or X++ (X+++ is filing-time only)."""
    if validate(h):
        return "X"  # an invalid intake never rates above directional
    # X+: core valid + refund target set + at least one parsed payslip
    if h.refund_target_low is None or not _parsed(h, "payslip"):
        return "X"
    # X++: X+ plus prior-year return, YTD payroll and carryforwards known
    if _parsed(h, "prior_return") and h.ytd_payroll_known and h.capital_loss_carryforward_known:
        return "X++"
    return "X+"
