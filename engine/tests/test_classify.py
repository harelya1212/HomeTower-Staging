"""Auto-classification tests (owner requirement, 2026-11-07): the user
uploads without naming the type; the app proposes, the user confirms.
Cases are hand-built from the real field-map labels."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hometower_engine.classify import classify_document
from hometower_engine.extract import RawField


def rf(*keys: str) -> list[RawField]:
    return [RawField(key=k, value="1", confidence=0.9) for k in keys]


def test_w2_detected():
    c = classify_document(rf("Wages, tips, other compensation", "Social security wages",
                             "Medicare wages and tips", "Federal income tax withheld"))
    assert c.doc_type == "w2" and c.level == "strong", c


def test_payslip_detected():
    c = classify_document(rf("Gross pay", "Federal income tax", "State income tax", "Year to date"))
    assert c.doc_type == "payslip", c


def test_1099b_detected():
    c = classify_document(rf("Proceeds", "Cost or other basis", "Gain or loss"))
    assert c.doc_type == "1099b" and c.level == "strong", c


def test_prior_return_detected_from_text():
    text = "Form 1040 U.S. Individual Income Tax Return\nAdjusted gross income 185,000\nTaxable income 152,800\nTotal tax 24,310"
    c = classify_document(rf("Adjusted gross income", "Taxable income", "Total tax"), text)
    assert c.doc_type == "prior_return" and c.level == "strong", c


def test_401k_detected():
    c = classify_document(rf("Ending balance", "Vested balance", "Employee contributions", "Employer contributions"))
    assert c.doc_type == "401k_statement", c


def test_unknown_falls_back_to_other():
    c = classify_document(rf("Banana bread recipe", "Preheat oven"))
    assert c.doc_type == "other" and c.level == "unknown", c


def test_signals_are_shown():
    c = classify_document(rf("Proceeds", "Cost or other basis"))
    assert c.signals, c


def test_8879_packet_is_prior_return_strong():
    # Real-file rehearsal shape (2026-11-07): an IRS e-file signature
    # packet IS part of the filed return - its own face must anchor it.
    fields = [RawField("Adjusted gross income", "338,962", 0.9), RawField("Total tax", "56,074", 0.9)]
    text = "Form 8879 IRS e-file Signature Authorization. Department of the Treasury, Internal Revenue Service."
    c = classify_document(fields, text)
    assert c.doc_type == "prior_return" and c.level == "strong", c


def test_repeated_labels_do_not_inflate():
    # A long document repeating one label must score it once.
    fields = [RawField("Proceeds", "1", 0.9)] * 20
    c = classify_document(fields, "")
    single = classify_document([RawField("Proceeds", "1", 0.9)], "")
    assert c.score == single.score, (c, single)


def test_pension_statement_classifies():
    fields = [RawField("Monthly benefit", "2,450", 0.9), RawField("Present value", "512,000", 0.9)]
    c = classify_document(fields, "Defined Benefit Pension Plan - annual retirement benefit statement")
    assert c.doc_type == "pension_statement" and c.level == "strong", c
