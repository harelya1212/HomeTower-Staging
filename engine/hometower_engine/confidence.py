"""Prediction confidence: one personal formula per household
(owner requirement, 2026-11-07).

The score (0-100) says how much the current projection can be trusted,
given THIS household's documents, their dates, its portfolio coverage,
and whether last year's filed return was verified against the real
IRS/state outcome (the calibration anchor). It is shown as a simple
visual indicator, per household and per document, and it is also the
app's honest cover: when a user does not update, the score falls and
says why - the projection never pretends to be fresher than its data.

Formula (weights sum to 100):
- Document completeness, up to 35: payslip 10, prior return 8, W-2 5,
  401(k) 4, HSA 4, 529 2, brokerage 2 (parsed documents only).
- Freshness, up to 25: mean freshness factor over present documents
  (fresh 1.0, aging 0.6, stale 0.2, unknown date 0.5) x 25.
- Extraction confidence, up to 10: mean stored confidence of parsed
  documents x 10.
- Portfolio coverage, up to 10: starts at 10; -4 if RSU is held with no
  brokerage statement, -3 ESPP likewise, -3 foreign holdings with no
  brokerage or other document.
- Calibration, up to 20: federal 14 (filed 4, actual outcome recorded 9,
  outcome verified 14) + state 6 (filed 2, recorded 4, verified 6).

Bands: >= 80 High, 55-79 Moderate, below 55 Low.
"""
from dataclasses import dataclass, field
from datetime import date

from .freshness import document_freshness
from .intake import DocumentRecord, HouseholdIntake

_DOC_WEIGHTS = {"payslip": 10, "prior_return": 8, "w2": 5, "401k_statement": 4,
                "hsa_statement": 4, "529_statement": 2, "brokerage_statement": 2}
_FRESHNESS_FACTOR = {"fresh": 1.0, "aging": 0.6, "stale": 0.2, "unknown": 0.5}


@dataclass
class DocumentIndicator:
    doc_type: str
    freshness_status: str
    counts: str  # fully | partially | barely
    note: str


@dataclass
class ConfidenceReport:
    score: int
    band: str  # High | Moderate | Low
    completeness: float
    freshness: float
    extraction: float
    coverage: float
    calibration: float
    reasons: list[str] = field(default_factory=list)  # top detractors, plain words
    calibration_missing: bool = True
    per_document: list[DocumentIndicator] = field(default_factory=list)


def _band(score: int) -> str:
    return "High" if score >= 80 else "Moderate" if score >= 55 else "Low"


def document_indicator(doc: DocumentRecord, today: date) -> DocumentIndicator:
    f = document_freshness(doc, today)
    if doc.status != "parsed":
        counts = "barely"
    elif f.status == "fresh":
        counts = "fully"
    elif f.status == "aging":
        counts = "partially"
    else:
        counts = "barely"
    return DocumentIndicator(doc.doc_type, f.status, counts, f.message)


def prediction_confidence(h: HouseholdIntake, today: date) -> ConfidenceReport:
    parsed = [d for d in h.documents if d.status == "parsed"]
    present_types = {d.doc_type for d in parsed}

    completeness = float(sum(w for t, w in _DOC_WEIGHTS.items() if t in present_types))

    if parsed:
        freshness = sum(_FRESHNESS_FACTOR[document_freshness(d, today).status] for d in parsed) / len(parsed) * 25
        extraction = sum(d.confidence for d in parsed) / len(parsed) * 10
    else:
        freshness = 0.0
        extraction = 0.0

    coverage = 10.0
    if h.has_rsu and "brokerage_statement" not in present_types:
        coverage -= 4
    if h.has_espp and "brokerage_statement" not in present_types:
        coverage -= 3
    if h.has_foreign_accounts_or_income and not ({"brokerage_statement", "other"} & present_types):
        coverage -= 3
    coverage = max(0.0, coverage)

    cal = h.calibration
    calibration = 0.0
    if cal is not None:
        if cal.federal_filed:
            calibration += 14 if (cal.outcome_verified and cal.actual_federal_refund_owe is not None) else \
                9 if cal.actual_federal_refund_owe is not None else 4
        if cal.state_filed:
            calibration += 6 if (cal.outcome_verified and cal.actual_state_refund_owe is not None) else \
                4 if cal.actual_state_refund_owe is not None else 2
    calibration_missing = not (cal is not None and cal.outcome_verified
                               and cal.actual_federal_refund_owe is not None)

    score = int(round(completeness + freshness + extraction + coverage + calibration))

    reasons: list[str] = []
    for d in parsed:
        f = document_freshness(d, today)
        if f.status == "stale":
            reasons.append(f"{d.doc_type} is stale - upload a current one")
        elif f.status == "aging":
            reasons.append(f"{d.doc_type} is about to expire")
    if "payslip" not in present_types:
        reasons.append("no current payslip on file")
    if calibration_missing:
        reasons.append("last year's filed return is not verified against the actual IRS/state outcome yet - add it to calibrate")
    if coverage < 10:
        reasons.append("some holdings (RSU/ESPP/foreign) have no matching statement on file")

    return ConfidenceReport(
        score=score,
        band=_band(score),
        completeness=completeness,
        freshness=round(freshness, 2),
        extraction=round(extraction, 2),
        coverage=coverage,
        calibration=calibration,
        reasons=reasons[:4],
        calibration_missing=calibration_missing,
        per_document=[document_indicator(d, today) for d in h.documents],
    )
