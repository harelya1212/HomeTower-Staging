"""US-Israel treaty tests (Phase 1, owner decision 2026-11-07).
Rates cross-checked against the IRS treaty table (Israel row).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hometower_engine.treaty import treaty_position, withholding_cap


def test_dividend_caps():
    assert withholding_cap("dividends").treaty_cap_rate == 0.25
    assert withholding_cap("dividends", corporate_10pct=True).treaty_cap_rate == 0.125


def test_interest_caps():
    assert withholding_cap("interest").treaty_cap_rate == 0.175
    assert withholding_cap("interest", financial_institution=True).treaty_cap_rate == 0.10
    assert withholding_cap("interest", government_backed=True).treaty_cap_rate == 0.0


def test_royalty_caps():
    assert withholding_cap("royalties", copyright_royalty=True).treaty_cap_rate == 0.10
    assert withholding_cap("royalties").treaty_cap_rate == 0.15


def test_social_security_survives_saving_clause():
    pos = treaty_position("social_security_benefits", us_citizen=True)
    assert pos.taxable_in == "paying_state_only"
    assert pos.saving_clause_overrides is False


def test_pension_saving_clause_for_us_citizen():
    pos = treaty_position("private_pensions", us_citizen=True)
    assert pos.saving_clause_overrides is True
    pos2 = treaty_position("private_pensions", us_citizen=False)
    assert pos2.saving_clause_overrides is False
