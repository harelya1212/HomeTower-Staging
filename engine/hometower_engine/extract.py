"""Source-agnostic document extraction.

Any OCR source (on-device in Phase 1) yields raw key-value pairs with a
per-value confidence. This module - ported from the prototype's
normalization logic, minus its AWS/Textract block parsing - applies the
field maps from the ocr-field-maps content pack, parses amounts, and
applies the confidence gate: a document is 'parsed' at confidence >= 0.80
and 'pending_verify' below it, so the user confirms or corrects every
field either way.
"""
import re
from dataclasses import dataclass, field
from typing import Optional

from .packs import load_pack

CONFIDENCE_GATE = 0.80


@dataclass
class RawField:
    key: str
    value: str
    confidence: float  # 0..1, from the OCR source


@dataclass
class ExtractionResult:
    document_type: str
    fields: dict = field(default_factory=dict)
    field_confidence: dict = field(default_factory=dict)
    confidence: float = 0.0
    status: str = "pending_verify"  # parsed | pending_verify


def _normalize_key(raw: str) -> str:
    return raw.lower().strip().replace(":", "").replace("*", "")


def _extract_amount(value_str: str) -> Optional[float]:
    cleaned = re.sub(r"[$,\s]", "", value_str.strip())
    cleaned = cleaned.replace("(", "-").replace(")", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_fields(raw_fields: list[RawField], document_type: str,
                     maps_pack: dict | None = None) -> ExtractionResult:
    maps_pack = maps_pack or load_pack("ocr-field-maps")
    field_map = maps_pack["maps"].get(document_type)
    if field_map is None:
        raise ValueError(f"Unknown document type: {document_type}")

    result = ExtractionResult(document_type=document_type)
    confidences: list[float] = []
    for raw in raw_fields:
        normalized = _normalize_key(raw.key)
        field_name = field_map.get(normalized)
        if not field_name:
            for map_key, map_field in field_map.items():
                # Fuzzy containment only when the shorter side is a
                # substantial phrase - a bare "refund" key must not
                # claim "total other payments and refundable credits"
                # (real-file rehearsal, 2026-11-07).
                if min(len(map_key), len(normalized)) >= 12 and (map_key in normalized or normalized in map_key):
                    field_name = map_field
                    break
        if not field_name:
            continue
        # Pure punctuation ("~~~~~~~", "----") is form furniture,
        # never a value.
        if not re.search(r"[A-Za-z0-9]", raw.value):
            continue
        amount = _extract_amount(raw.value)
        # Household documents do not carry nine-figure amounts; a
        # digit string that large is a routing/account fragment.
        if amount is not None and abs(amount) >= 100_000_000:
            continue
        existing = result.fields.get(field_name)
        # First PARSED amount wins (real-file rehearsal, 2026-11-07):
        # long documents repeat labels in schedules and prose; an early
        # clean figure must not be overwritten by a later sentence, and
        # a prose value is replaced as soon as a real amount appears.
        # One exception: a parsed ZERO is provisional - state forms
        # print furniture like "Arizona Adjusted Gross Income ~ 00"
        # ahead of the real federal figure, so a later non-zero amount
        # replaces a zero (real packet rehearsal, 2026-11-07).
        if amount is not None:
            if existing is None or isinstance(existing, str) or (existing == 0 and amount != 0):
                result.fields[field_name] = amount
                result.field_confidence[field_name] = raw.confidence
                confidences.append(raw.confidence)
        elif existing is None:
            result.fields[field_name] = raw.value.strip()
            result.field_confidence[field_name] = raw.confidence
            confidences.append(raw.confidence)

    result.confidence = round(sum(confidences) / len(confidences), 3) if confidences else 0.0
    result.status = "parsed" if result.confidence >= CONFIDENCE_GATE else "pending_verify"
    return result
