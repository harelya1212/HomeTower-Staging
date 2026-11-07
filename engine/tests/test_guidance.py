"""Tests for guidance.py - SPEC45 sections 16, 17, 20, 39+42."""
from datetime import date

from hometower_engine.guidance import (
    NextActionInput, ProfileExtras, annual_focus, document_requests,
    next_action, next_phase_start, payroll_shortcut,
)
from hometower_engine.intake import (
    CalibrationRecord, DocumentRecord, HouseholdIntake, Member,
)

TODAY = date(2026, 11, 7)


def _household(**kw) -> HouseholdIntake:
    base = dict(name="T", state="AZ", filing_status="married_filing_jointly",
                members=[Member("A", "adult", pay_frequency="biweekly")], documents=[])
    base.update(kw)
    return HouseholdIntake(**base)


def test_requests_minimal_household():
    reqs = document_requests(_household(), ProfileExtras(), TODAY)
    keys = [r.key for r in reqs]
    assert keys == ["prior_return", "calibration_outcome", "payslip", "w2"], keys
    assert all(r.status == "missing" for r in reqs)


def test_requests_full_profile():
    h = _household(has_rsu=True)
    ex = ProfileExtras(has_hsa=True, has_brokerage=True, has_rental=True, has_college_student=True)
    keys = [r.key for r in document_requests(h, ex, TODAY)]
    for expected in ("brokerage", "stock_plan", "hsa_statement", "hsa_election",
                     "529", "1098t", "1099q", "bursar", "rental_pack"):
        assert expected in keys, keys
    assert len(keys) == 13, keys


def test_requests_satisfied_and_stale():
    h = _household(documents=[
        DocumentRecord("payslip", "parsed", 0.95, date(2026, 11, 1)),
        DocumentRecord("prior_return", "parsed", 1.0, date(2026, 3, 1)),
    ], calibration=CalibrationRecord(2025, federal_filed=True, state_filed=True,
                                     actual_federal_refund_owe=2400.0,
                                     actual_state_refund_owe=1100.0, outcome_verified=True))
    by_key = {r.key: r for r in document_requests(h, ProfileExtras(), TODAY)}
    assert by_key["payslip"].status == "satisfied"
    assert by_key["prior_return"].status == "satisfied"
    assert by_key["calibration_outcome"].status == "satisfied"
    stale = _household(documents=[DocumentRecord("payslip", "parsed", 0.9, date(2026, 9, 1))])
    by_key2 = {r.key: r for r in document_requests(stale, ProfileExtras(), TODAY)}
    assert by_key2["payslip"].status == "stale"


def test_payroll_shortcut_provisional():
    r = payroll_shortcut("no", "no", "no", 0)
    assert r.provisional and not r.needs_document and r.consecutive_after == 1


def test_payroll_shortcut_verification_due():
    r = payroll_shortcut("no", "no", "no", 2)
    assert not r.provisional and r.needs_document


def test_payroll_shortcut_changed():
    r = payroll_shortcut("yes", "no", "no", 0)
    assert not r.provisional and r.needs_document and r.consecutive_after == 0
    r2 = payroll_shortcut("no", "unsure", "no", 1)
    assert r2.needs_document


def test_annual_focus():
    assert annual_focus(1).key == "january_reset"
    assert annual_focus(3).key == "quarterly_check"
    assert annual_focus(6).key == "june_review"
    assert annual_focus(10).key == "landing_forecast"
    assert annual_focus(11).key == "november_window"
    assert annual_focus(12).key == "december_lock"
    assert next_phase_start(11) == (12, "December - Final Tax Lock")
    assert next_phase_start(12) == (1, "January - Financial Reset")


def _input(**kw) -> NextActionInput:
    base = dict(calibration_missing=False, verification_due=False,
                confidence_band="High", confidence_score=85)
    base.update(kw)
    return NextActionInput(**base)


def test_next_action_priority():
    a = next_action(_input(verification_due=True, calibration_missing=True))
    assert "payslip" in a.action
    a = next_action(_input(calibration_missing=True, stale_docs=["payslip"]))
    assert "filed return" in a.action
    a = next_action(_input(stale_docs=["payslip"]))
    assert "payslip" in a.action
    a = next_action(_input(missing_request_label="Latest brokerage statement"))
    assert "brokerage" in a.action
    a = next_action(_input(aging_docs=["HSA statement"]))
    assert "HSA" in a.action


def test_next_action_below_target():
    a = next_action(_input(federal_position="below", federal_delta=1234.0))
    assert "$1,234" in a.why and "$1,234" in a.expected_benefit


def test_next_action_above_target_and_on_track():
    a = next_action(_input(federal_position="above", federal_delta=800.0))
    assert "reducing federal withholding" in a.action
    a = next_action(_input(annual_phase_title="November - Final Optimization Window"))
    assert "on track" in a.action and "November" in a.why
    assert a.confidence == "High (85/100)"
