"""Document auto-classification (owner requirement, 2026-11-07).

The user uploads a file WITHOUT naming its type - or names it, and the
app still verifies. Classification is deterministic and explainable:
score = 3 x (field-map labels matched, each label counted ONCE)
+ 1 per distinctive keyword found in the raw keys or the full text
+ 3 per IDENTITY ANCHOR - rare, document-defining phrases (a real-file
rehearsal on 2026-11-07 showed why: a 108-page tax return contains
1099-B schedules whose repeated labels outvoted the return's own
identity; anchors + label dedup keep the document's identity ahead of
its attachments).
The output is always a PROPOSAL with its signals: the user confirms or
overrides the type before anything is saved, and the same check runs
when the user did name a type, so a mismatch is surfaced, not stored.
"""
from dataclasses import dataclass, field
from typing import Optional

from .extract import RawField, _normalize_key
from .packs import load_pack

KEYWORDS: dict[str, list[str]] = {
    "w2": ["w-2", "wage and tax statement", "wages tips", "social security wages", "medicare wages"],
    "payslip": ["gross pay", "net pay", "pay period", "pay date", "year to date", "earnings statement"],
    "1099b": ["1099-b", "proceeds", "cost or other basis", "date acquired", "date sold"],
    "1098t": ["1098-t", "qualified tuition", "tuition and fees", "scholarships or grants"],
    "1099q": ["1099-q", "gross distribution", "qualified education expenses"],
    "hsa_statement": ["health savings account", "hsa"],
    "401k_statement": ["401(k)", "401k", "vested balance", "retirement savings plan"],
    "529_statement": ["529 plan", "college savings plan", "education account"],
    "brokerage_statement": ["brokerage", "securities account", "portfolio value", "holdings"],
    "prior_return": ["1040", "adjusted gross income", "taxable income", "internal revenue service", "u.s. individual income tax return"],
}

# Identity anchors: phrases that DEFINE the document (they appear on
# its own face, not inside attachments it may contain). +3 each, once.
ANCHORS: dict[str, list[str]] = {
    "prior_return": ["form 1040", "form 8879", "e-file signature authorization"],
}


@dataclass
class Classification:
    doc_type: str            # winning type, or "other" when nothing scores
    level: str               # strong | likely | unknown
    score: int
    signals: list = field(default_factory=list)   # what matched, for the user
    runner_up: Optional[str] = None
    runner_up_score: int = 0


def classify_document(raw_fields: list[RawField], text: str = "",
                      maps_pack: dict | None = None) -> Classification:
    maps = (maps_pack or load_pack("ocr-field-maps"))["maps"]
    keys = [_normalize_key(f.key) for f in raw_fields]
    haystack = (" ".join(keys) + " " + text.lower())
    scored: list[tuple[str, int, list[str]]] = []
    for doc_type, field_map in maps.items():
        if doc_type == "other":
            continue
        matched = sorted({k for k in keys if k in field_map})
        kw_hits = [kw for kw in KEYWORDS.get(doc_type, []) if kw in haystack]
        anchor_hits = [a for a in ANCHORS.get(doc_type, []) if a in haystack]
        scored.append((doc_type, 3 * len(matched) + len(kw_hits) + 3 * len(anchor_hits), matched + kw_hits + anchor_hits))
    scored.sort(key=lambda s: (-s[1], s[0]))
    best_type, best_score, best_signals = scored[0]
    runner_type, runner_score = (scored[1][0], scored[1][1]) if len(scored) > 1 else (None, 0)
    if best_score >= 6:
        level = "strong"
    elif best_score >= 3:
        level = "likely"
    else:
        return Classification("other", "unknown", best_score, [], runner_type, runner_score)
    return Classification(best_type, level, best_score, best_signals[:5], runner_type, runner_score)
