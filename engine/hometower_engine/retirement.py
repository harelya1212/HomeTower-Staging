"""Retirement dual-source resolution (round 53, Python parity).

The TypeScript app (app/src/goals.ts) resolves two retirement
inputs from two sources each, under Copilot's source doctrine:
statements say what the household HAS; payslips say what it is
ADDING. The Python engine has no retirement-projection consumer
today, so this module is the reference implementation of the same
chain, with tests pinning the same cases as the TS suite
(GT6 / AC-D1 / AC-D3 / AC-D4):

- current balance -> the owned 401(k) statement's ending balance
  beats the household's own asset rows for that account
  (adult_starting_balance mirrors the TS rule);
- employee pace -> the latest regular payslip (computed by the
  caller's payslip layer; this module takes the resolved figure);
- employer match -> the latest regular payslip WITH a match line,
  else the latest OWNED 401(k) statement (employer contributions
  over the statement's own period, monthly), else a user-confirmed
  figure, else UNKNOWN.

Unknown is a distinct state, never zero: MatchResolution.monthly is
None whenever no source produced a figure, so an unknown can never
be summed into a projection as $0 by accident. (The TS model
carries monthly=0 plus a status for the same states; the status
vocabulary is identical, and "no figure" is what both mean.)
"""
import re
from dataclasses import dataclass
from datetime import date
from typing import Optional

# Field names follow the shared OCR field maps (packs.py), the same
# names the TS side reads.
EMPLOYER_TOTAL_FIELDS = ("employer_contribution_period", "employer_contributions")


def _num(fields: Optional[dict], key: str) -> float:
    if not fields:
        return 0.0
    raw = fields.get(key)
    if raw is None:
        return 0.0
    try:
        v = float(str(raw).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return 0.0
    return v if v == v and v not in (float("inf"), float("-inf")) else 0.0  # NaN / inf guard


def _parse_date(s: str) -> Optional[date]:
    s = (s or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    return None


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month) + (1 if b.day >= a.day else 0)


def statement_period_months(fields: Optional[dict]) -> Optional[int]:
    """How many months a 401(k) statement's employer-contribution
    total covers - read ONLY from the statement itself: an explicit
    months field, else its start/end dates, else a period range
    string. A quarter is never assumed; unknown period -> None."""
    if not fields:
        return None
    explicit = _num(fields, "statement_period_months")
    if explicit > 0:
        return round(explicit)
    start = _parse_date(str(fields.get("statement_period_start") or ""))
    end = _parse_date(str(fields.get("statement_period_end") or ""))
    if start and end:
        months = _months_between(start, end)
        return months if months > 0 else None
    rng = str(fields.get("statement_period") or "")
    parts = [p.strip() for p in re.split(r"\s+-\s+|\s+to\s+", rng) if p.strip()]
    if len(parts) == 2:
        a, b = _parse_date(parts[0]), _parse_date(parts[1])
        if a and b:
            months = _months_between(a, b)
            return months if months > 0 else None
    return None


@dataclass
class StatementMatch:
    monthly: Optional[float]  # None when the period is not stated
    period_total: float
    months: Optional[int]
    captured_on: Optional[str]


def k401_statement_match_for(documents: list, member_id: str) -> Optional[StatementMatch]:
    """The freshest 401(k) statement OWNED by this member that
    carries employer contributions (round 51/52 source doctrine).
    A statement with no identified owner is never used."""
    best: Optional[StatementMatch] = None
    best_on = ""
    for d in documents or []:
        if d.get("docType") != "401k_statement" or d.get("ownerMemberId") != member_id:
            continue
        fields = d.get("fields") or {}
        total = 0.0
        for key in EMPLOYER_TOTAL_FIELDS:
            v = _num(fields, key)
            if v > 0:
                total = v
                break
        if total <= 0:
            continue
        on = d.get("capturedOn") or ""
        if best is not None and on <= best_on:
            continue
        months = statement_period_months(fields)
        monthly = round(total / months * 100) / 100 if months else None
        best = StatementMatch(monthly=monthly, period_total=total, months=months, captured_on=on or None)
        best_on = on
    return best


@dataclass
class MatchResolution:
    monthly: Optional[float]  # None = no figure from any source
    status: str  # from_payslip | from_statement | user_confirmed | not_detected | unknown
    source_label: str
    detected_not_paced: bool = False
    statement_on: Optional[str] = None


_SOURCE_LABEL = {
    "from_payslip": "From payslip",
    "from_statement": "From statement",
    "user_confirmed": "Entered by you",
    "not_detected": "Not detected",
    "unknown": "Unknown",
}


def employer_match_for(
    payslip_monthly: Optional[float] = None,
    statement: Optional[StatementMatch] = None,
    user_monthly: Optional[float] = None,
    relevant_docs_exist: bool = False,
) -> MatchResolution:
    """Employer-match resolution, in the doctrine's order. A
    payslip monthly of 0.0 is a REAL figure (the slip prints a zero
    match line) and wins like any other; only None means the
    payslips carry no match."""
    if payslip_monthly is not None:
        return MatchResolution(monthly=payslip_monthly, status="from_payslip", source_label=_SOURCE_LABEL["from_payslip"])
    if statement is not None and statement.monthly is not None:
        return MatchResolution(
            monthly=statement.monthly, status="from_statement",
            source_label=_SOURCE_LABEL["from_statement"], statement_on=statement.captured_on,
        )
    if statement is not None:
        # Detected on a statement but its period is not stated: a
        # pace is never guessed.
        return MatchResolution(
            monthly=None, status="not_detected", source_label=_SOURCE_LABEL["not_detected"],
            detected_not_paced=True, statement_on=statement.captured_on,
        )
    if user_monthly is not None and user_monthly > 0:
        return MatchResolution(monthly=user_monthly, status="user_confirmed", source_label=_SOURCE_LABEL["user_confirmed"])
    status = "not_detected" if relevant_docs_exist else "unknown"
    return MatchResolution(monthly=None, status=status, source_label=_SOURCE_LABEL[status])


@dataclass
class AdultStartingBalance:
    balance: float
    statement_applied: bool
    replaced_401k: float


def adult_starting_balance(owned: list, fallback: float, statement401k: float) -> AdultStartingBalance:
    """Mirror of the TS rule: an owned 401(k) statement's ending
    balance REPLACES the member's own 401(k) asset rows inside the
    composition (the same account never counts twice); with no
    owned rows it becomes the balance only when there is no other
    balance on file; a manual household balance still wins when the
    member has neither rows nor a statement."""
    owned_sum = sum(float(a.get("value") or 0) for a in owned or [])
    if not (statement401k and statement401k > 0):
        return AdultStartingBalance(
            balance=owned_sum if owned else fallback,
            statement_applied=False, replaced_401k=0.0,
        )
    if owned:
        own_401 = sum(float(a.get("value") or 0) for a in owned if a.get("kind") == "401k")
        return AdultStartingBalance(
            balance=owned_sum - own_401 + statement401k,
            statement_applied=True, replaced_401k=own_401,
        )
    if not (fallback and fallback > 0):
        return AdultStartingBalance(balance=statement401k, statement_applied=True, replaced_401k=0.0)
    return AdultStartingBalance(balance=fallback, statement_applied=False, replaced_401k=0.0)
