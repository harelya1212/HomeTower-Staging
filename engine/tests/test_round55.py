"""Round 55 (Python parity): the two HSA tax-form document types
and the expanded 401(k) labels, through the shared field maps.

The fan-out, provenance, reconciliation and reprocessing
machinery is app-side (TypeScript) by architecture - statements
are segmented and resolved where the documents live. What the
Python engine shares is the maps themselves (byte-identical in
both copies), classification, extraction and intake validation,
and those are pinned here."""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hometower_engine.classify import classify_document
from hometower_engine.extract import RawField, extract_fields
from hometower_engine.freshness import document_freshness
from hometower_engine.intake import DOCUMENT_TYPES, DocumentRecord, HouseholdIntake, Member, validate

ROOT = Path(__file__).resolve().parent.parent


def rf(*pairs: tuple[str, str]) -> list[RawField]:
    return [RawField(key=k, value=v, confidence=0.9) for k, v in pairs]


def test_maps_byte_identical_and_v113():
    py_copy = (ROOT / "content" / "ocr-field-maps.json").read_bytes()
    ts_copy = (ROOT.parent / "app" / "packs" / "ocr-field-maps.json").read_bytes()
    assert py_copy == ts_copy, "field maps must stay byte-identical across the two copies"
    pack = json.loads(py_copy)
    assert pack["version"] == "1.13", pack["version"]
    assert "hsa_1099_sa" in pack["maps"] and "hsa_5498_sa" in pack["maps"]


def test_5498_sa_classifies_and_extracts():
    fields = rf(
        ("box 2 total contributions", "$8,544.00"),
        ("box 3 contributions for prior year", "$0.00"),
        ("box 4 rollover contributions", "$0.00"),
        ("box 5 fair market value", "$15,051.63"),
        ("box 6 account type", "HSA"),
    )
    c = classify_document(fields, "2025 Form 5498-SA\nFair Market Value of HSA")
    assert c.doc_type == "hsa_5498_sa" and c.level == "strong", c
    r = extract_fields(fields, "hsa_5498_sa")
    assert r.fields["box_2_contributions"] == 8544.0, r.fields
    assert r.fields["box_5_fair_market_value"] == 15051.63, r.fields
    assert r.fields["box_3_contributions_prior_year"] == 0.0, r.fields


def test_1099_sa_classifies_and_extracts():
    fields = rf(
        ("box 1 gross distribution", "$7,743.99"),
        ("box 2 earnings on excess contributions", "$0.00"),
        ("box 3 distribution code", "1"),
        ("box 4 fair market value on date of death", "$0.00"),
        ("box 5 account type", "HSA"),
    )
    c = classify_document(fields, "2025 Form 1099-SA\nDistributions From an HSA\nGross Distribution")
    assert c.doc_type == "hsa_1099_sa" and c.level == "strong", c
    r = extract_fields(fields, "hsa_1099_sa")
    assert r.fields["box_1_gross_distribution"] == 7743.99, r.fields
    assert r.fields["box_3_distribution_code"] == 1.0, r.fields


def test_expanded_401k_labels_extract():
    fields = rf(
        ("Pretax/Roth YTD Contributions", "$23,269.74"),
        ("After-Tax YTD Contributions", "$7,240.72"),
        ("ER Match YTD Contributions", "$11,466.08"),
        ("Total YTD 415 limit Contrib", "$41,976.54"),
        ("Your Contributions", "$30,510.46"),
    )
    r = extract_fields(fields, "401k_statement")
    assert r.fields["employee_pretax_roth_ytd"] == 23269.74, r.fields
    assert r.fields["after_tax_ytd"] == 7240.72, r.fields
    assert r.fields["employer_contribution_period"] == 11466.08, r.fields
    assert r.fields["total_415_ytd"] == 41976.54, r.fields
    assert r.fields["employee_contributions"] == 30510.46, r.fields


def test_sa_doc_types_are_valid_intake():
    assert "hsa_1099_sa" in DOCUMENT_TYPES and "hsa_5498_sa" in DOCUMENT_TYPES
    h = HouseholdIntake(
        name="Harel", state="AZ", filing_status="mfj",
        members=[Member(name="Assaf Harel", role="self")],
        documents=[
            DocumentRecord(doc_type="hsa_1099_sa", status="parsed", confidence=1.0,
                           fields={"box_1_gross_distribution": "7743.99", "tax_year": "2025"},
                           form_boxes={"box_1_gross_distribution": "7743.99"}),
            DocumentRecord(doc_type="hsa_5498_sa", status="parsed", confidence=1.0,
                           fields={"box_5_fair_market_value": "15051.63", "tax_year": "2025"}),
        ],
    )
    errors = validate(h)
    assert not any("document type" in e for e in errors), errors


def test_sa_freshness_windows_exist():
    doc = DocumentRecord(doc_type="hsa_1099_sa", status="parsed", confidence=1.0,
                         captured_on=date(2026, 1, 15))
    f = document_freshness(doc, date(2026, 2, 1))
    assert f.status != "unknown", f
