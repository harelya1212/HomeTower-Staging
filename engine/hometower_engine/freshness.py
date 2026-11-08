"""Document freshness (owner requirement, 2026-11-07).

Every document type has a freshness window in days. A document is:
- fresh: within its window,
- aging: inside the last AGING_WARNING_DAYS of its window (warn early),
- stale: past its window - the snapshot can no longer trust it, the app
  flags it, and it becomes a push-reminder candidate.
Windows: monthly documents ~35 days, quarterly statements ~100 days,
annual tax documents ~400 days.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional

from .intake import DocumentRecord

FRESHNESS_WINDOW_DAYS = {
    "payslip": 35,
    "brokerage_statement": 40,
    "401k_statement": 100,
    "hsa_statement": 100,
    "529_statement": 100,
    "w2": 400,
    "1099b": 400,
    "1098t": 400,
    "1099q": 400,
    "prior_return": 400,
    "pension_statement": 400,
    "other": 180,
}
AGING_WARNING_DAYS = 7


@dataclass
class FreshnessFinding:
    doc_type: str
    status: str  # fresh | aging | stale | unknown
    age_days: Optional[int]
    window_days: int
    message: str


def document_freshness(doc: DocumentRecord, today: date) -> FreshnessFinding:
    window = FRESHNESS_WINDOW_DAYS.get(doc.doc_type, 180)
    if doc.captured_on is None:
        return FreshnessFinding(doc.doc_type, "unknown", None, window,
                                f"{doc.doc_type}: no capture date recorded - freshness unknown.")
    age = (today - doc.captured_on).days
    if age > window:
        return FreshnessFinding(doc.doc_type, "stale", age, window,
                                f"{doc.doc_type} is {age} days old (window {window}) - update it.")
    if age >= window - AGING_WARNING_DAYS:
        return FreshnessFinding(doc.doc_type, "aging", age, window,
                                f"{doc.doc_type} expires in {window - age} days - a newer one is due.")
    return FreshnessFinding(doc.doc_type, "fresh", age, window,
                            f"{doc.doc_type} is fresh ({age} days old).")


def household_freshness(documents: list[DocumentRecord], today: date) -> list[FreshnessFinding]:
    """Findings needing attention first: stale, then aging, then the rest."""
    order = {"stale": 0, "aging": 1, "unknown": 2, "fresh": 3}
    findings = [document_freshness(d, today) for d in documents]
    return sorted(findings, key=lambda f: order[f.status])


def reminder_candidates(documents: list[DocumentRecord], today: date) -> list[FreshnessFinding]:
    """What push reminders are sent about: stale and aging documents."""
    return [f for f in household_freshness(documents, today) if f.status in ("stale", "aging")]
