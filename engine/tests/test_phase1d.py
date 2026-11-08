"""Tests for intake, extract, equity and foreign modules (Phase 1D +
owner-expanded Phase 1 scope, 2026-11-07). Expected values hand-computed.
Run with engine/tests/test_golden.py: python3 -m pytest engine/tests -q
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hometower_engine.equity import espp_disposition, rsu_vest
from hometower_engine.extract import RawField, extract_fields
from hometower_engine.foreign import fbar_required, foreign_tax_credit, form_8938_required
from hometower_engine.intake import (DocumentRecord, HouseholdIntake, Member,
                                     accuracy_level, validate)

MFJ = "married_filing_jointly"


# ---------- intake ----------

def _household(**over):
    base = dict(name="Test Family", state="AZ", filing_status=MFJ,
                members=[Member("A", "adult", date(1990, 1, 1), "biweekly"),
                         Member("B", "adult", date(1991, 1, 1), "biweekly")])
    base.update(over)
    return HouseholdIntake(**base)


def test_intake_valid_and_levels():
    h = _household()
    assert validate(h) == []
    assert accuracy_level(h) == "X"
    h.refund_target_low, h.refund_target_high = 2_000, 3_000
    h.documents.append(DocumentRecord("payslip", "parsed", 0.93))
    assert accuracy_level(h) == "X+"
    h.documents.append(DocumentRecord("prior_return", "parsed", 0.9))
    h.ytd_payroll_known = True
    h.capital_loss_carryforward_known = True
    assert accuracy_level(h) == "X++"


def test_intake_invalid_target():
    h = _household(refund_target_low=3_000, refund_target_high=2_000)
    assert any("refund target" in e for e in validate(h))
    assert accuracy_level(h) == "X"  # invalid intake never rates above X


# ---------- extract ----------

def test_extract_payslip_parsed():
    raw = [RawField("Gross Pay", "$5,000", 0.95),
           RawField("Federal Income Tax", "$800", 0.90),
           RawField("401(k)", "$250", 0.92),
           RawField("Unrelated Label", "xyz", 0.99)]
    r = extract_fields(raw, "payslip")
    assert r.fields == {"gross_pay": 5000.0, "federal_withheld": 800.0, "k401_contribution": 250.0}
    assert r.confidence == 0.923
    assert r.status == "parsed"


def test_extract_low_confidence_pending_verify():
    raw = [RawField("Wages, Tips, Other Compensation", "($1,200)", 0.60)]
    r = extract_fields(raw, "w2")
    assert r.fields["wages"] == -1200.0  # parentheses parse as negative
    assert r.status == "pending_verify"


# ---------- equity: RSU ----------

def test_rsu_vest_withholding_gap():
    # 1,000 shares x $50 = $50,000 income; withheld 22% = $11,000.
    # Household MFJ other income $200,000: tax delta = 37,468 - 26,340 = 11,128.
    r = rsu_vest(1_000, 50.0, date(2026, 3, 1), MFJ, 200_000)
    assert r.ordinary_income == 50_000.0
    assert r.federal_withheld == 11_000.0
    assert r.projected_additional_tax == 11_128.0
    assert r.projected_gap == 128.0
    assert r.lot_basis_per_share == 50.0


def test_rsu_vest_above_supplemental_threshold():
    # $990K supplemental YTD: only $10K of this vest at 22%, $40K at 37%.
    r = rsu_vest(1_000, 50.0, date(2026, 3, 1), MFJ, 200_000,
                 supplemental_wages_ytd_before=990_000)
    assert r.federal_withheld == 2_200.0 + 14_800.0


# ---------- equity: ESPP ----------

def test_espp_disqualifying():
    r = espp_disposition(100, date(2024, 1, 1), 40.0, date(2024, 7, 1), 50.0, 34.0,
                         date(2025, 3, 1), 60.0)
    assert r.classification == "disqualifying"
    assert r.ordinary_income_total == 1_600.0  # (50 - 34) x 100
    assert r.basis_per_share == 50.0
    assert r.capital_gain_total == 1_000.0
    assert r.capital_is_long_term is False


def test_espp_qualifying():
    r = espp_disposition(100, date(2023, 1, 1), 40.0, date(2023, 7, 1), 50.0, 34.0,
                         date(2025, 8, 1), 60.0)
    assert r.classification == "qualifying"
    assert r.ordinary_income_total == 600.0  # min(40-34, 60-34) x 100
    assert r.basis_per_share == 40.0
    assert r.capital_gain_total == 2_000.0
    assert r.capital_is_long_term is True


def test_espp_qualifying_at_loss():
    r = espp_disposition(100, date(2023, 1, 1), 40.0, date(2023, 7, 1), 50.0, 34.0,
                         date(2025, 8, 1), 30.0)
    assert r.ordinary_income_total == 0.0
    assert r.capital_gain_total == -400.0


# ---------- foreign ----------

def test_fbar():
    assert fbar_required([6_000, 5_000]).required is True
    assert fbar_required([4_000, 4_000]).required is False


def test_form_8938():
    assert form_8938_required(120_000, 130_000, MFJ).required is True
    assert form_8938_required(40_000, 70_000, "single").required is False
    assert form_8938_required(250_000, 260_000, "single", living_abroad=True).required is True


def test_foreign_tax_credit_limitation():
    # limit = 26,340 x 20,000 / 167,800 = 3,139.45
    r = foreign_tax_credit(3_000, 20_000, 167_800, 26_340)
    assert r.limitation == 3_139.45
    assert r.credit_allowed == 3_000.0
    r2 = foreign_tax_credit(5_000, 20_000, 167_800, 26_340)
    assert r2.credit_allowed == 3_139.45
    assert r2.excess_credit == 1_860.55


# ---------- freshness ----------

def test_freshness_windows():
    from datetime import date as _date
    from hometower_engine.freshness import document_freshness, reminder_candidates
    today = _date(2026, 11, 7)
    stale = document_freshness(DocumentRecord("payslip", "parsed", 0.9, _date(2026, 10, 1)), today)
    assert stale.status == "stale" and stale.age_days == 37
    aging = document_freshness(DocumentRecord("payslip", "parsed", 0.9, _date(2026, 10, 8)), today)
    assert aging.status == "aging"  # age 30, window 35, inside the 7-day warning
    fresh = document_freshness(DocumentRecord("401k_statement", "parsed", 0.9, _date(2026, 9, 18)), today)
    assert fresh.status == "fresh"
    cands = reminder_candidates([DocumentRecord("payslip", "parsed", 0.9, _date(2026, 10, 1)),
                                 DocumentRecord("401k_statement", "parsed", 0.9, _date(2026, 9, 18))], today)
    assert [c.doc_type for c in cands] == ["payslip"]


# ---------- prediction confidence ----------

def test_confidence_scores():
    from datetime import date as _date
    from hometower_engine.confidence import prediction_confidence
    from hometower_engine.intake import CalibrationRecord
    today = _date(2026, 11, 7)

    empty = _household()
    r = prediction_confidence(empty, today)
    assert r.score == 10 and r.band == "Low" and r.calibration_missing is True

    full = _household(documents=[
        DocumentRecord(t, "parsed", 1.0, today) for t in
        ("payslip", "prior_return", "w2", "401k_statement", "hsa_statement", "529_statement", "brokerage_statement")],
        calibration=CalibrationRecord(2025, True, True, 2400.0, 1100.0, True))
    r = prediction_confidence(full, today)
    assert r.score == 100 and r.band == "High" and r.calibration_missing is False

    stale = _household(documents=[DocumentRecord("payslip", "parsed", 0.9, _date(2026, 10, 1))])
    r = prediction_confidence(stale, today)
    assert r.score == 34 and r.per_document[0].counts == "barely"

    rsu = _household(has_rsu=True)
    assert prediction_confidence(rsu, today).coverage == 6.0


def test_extract_first_parsed_amount_wins():
    from hometower_engine.extract import extract_fields, RawField
    fields = [
        RawField("Adjusted gross income", "See instructions below", 0.9),
        RawField("Adjusted gross income", "338,962", 0.9),
        RawField("Adjusted gross income", "999", 0.9),
    ]
    out = extract_fields(fields, "prior_return")
    assert out.fields.get("adjusted_gross_income") == 338962.0, out.fields


def test_extract_guards_against_form_furniture():
    from hometower_engine.extract import extract_fields, RawField
    fields = [
        RawField("REFUND", "~~~~~~~", 0.9),                       # punctuation value + short fuzzy key
        RawField("Enter the amount of refund", "7177609430", 0.9),  # digit fragment over the cap
        RawField("Adjusted gross income", "338,962", 0.9),
    ]
    out = extract_fields(fields, "prior_return")
    assert "refund" not in out.fields, out.fields
    assert "total_payments" not in out.fields, out.fields
    assert out.fields.get("adjusted_gross_income") == 338962.0, out.fields
