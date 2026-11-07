"""Golden tests for the HomeTower engine.

Expected values were computed independently of the engine code (hand
arithmetic on the pack's bracket tables) and are asserted as literals.
Run: python3 -m pytest engine/tests -q   (from the repo root)
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hometower_engine.federal import compute_federal_tax, compute_ltcg_tax, compute_niit
from hometower_engine.state import compute_arizona_tax, compute_state_tax_on_gain
from hometower_engine.snapshot import ScenarioInput, compute_household_tax, simulate_scenario
from hometower_engine.taximpact import SaleInput, SimulationContext, simulate
from hometower_engine.wash_sale import TaxLot, check_wash_sale

MFJ = "married_filing_jointly"


def test_g1_federal_ordinary_mfj():
    # Rev. Proc. 2025-32: gross 200,000 - std deduction 32,200 = taxable 167,800
    # 24,800*.10 + 76,000*.12 + 67,000*.22 = 2,480 + 9,120 + 14,740 = 26,340
    r = compute_federal_tax(200_000, MFJ)
    assert r.taxable_income == 167_800
    assert r.total_tax == 26_340.0


def test_g2_ltcg_stacking():
    # ordinary taxable 60,000; gain 50,000; 0% LTCG space to 98,900 = 38,900
    # remaining 11,100 at 15% = 1,665
    assert compute_ltcg_tax(50_000, 60_000, MFJ) == 1_665.0


def test_g3_federal_single():
    # gross 80,000 - 16,100 = 63,900
    # 12,400*.10 + 38,000*.12 + 13,500*.22 = 1,240 + 4,560 + 2,970 = 8,770
    r = compute_federal_tax(80_000, "single")
    assert r.total_tax == 8_770.0


def test_g4_wash_sale_triggered():
    lots = [TaxLot("ACME", "BrokerA", 100, date(2026, 6, 15), 90.0)]
    r = check_wash_sale("ACME", date(2026, 6, 1), -10.0, 100, lots)
    assert r.triggered is True
    assert r.disallowed_loss == 1_000.0


def test_g5_arizona_flat():
    assert compute_arizona_tax(100_000) == 2_500.0
    assert compute_state_tax_on_gain(10_000, "AZ").tax == 250.0


def test_g6_niit():
    # MAGI 300,000 vs MFJ threshold 250,000; lesser of NII 50,000 / excess 50,000
    assert compute_niit(300_000, 50_000, MFJ) == 1_900.0
    snap = compute_household_tax(MFJ, 300_000, net_investment_income=50_000)
    assert snap.niit == 1_900.0


def test_g7_regression_st_timing_comparison_no_crash():
    # The prototype crashed here (undefined magi_value). ST gain of 500:
    # ordinary taxable = 120,000 - 32,200 = 87,800, marginal rate 12%;
    # ST federal = 500 * 12% = 60; LT federal = 0 (0% bracket room to 98,900);
    # state 2.5% both ways; waiting must save exactly the 60 difference.
    sale = SaleInput("ACME", "BrokerA", 10, 100.0, 150.0, date(2026, 1, 1), date(2026, 6, 1))
    ctx = SimulationContext(MFJ, 2026, "AZ", 120_000)
    r = simulate(sale, ctx)
    assert r.timing is not None
    assert r.timing.tax_savings_by_waiting == 60.0
    assert r.impact.is_long_term is False


def test_g8_regression_change_withholding_applies():
    # The prototype accepted change_withholding and ignored it.
    out = simulate_scenario(ScenarioInput(MFJ, 150_000, 20_000, 4_000, "change_withholding", 1_000))
    assert out["federal_tax_delta"] == 0.0
    assert out["modified_refund_owe"] - out["base_refund_owe"] == 1_000.0


def test_g9_carryforward_applied():
    sale = SaleInput("ACME", "BrokerA", 10, 100.0, 1_100.0, date(2024, 1, 1), date(2026, 6, 1))
    ctx = SimulationContext(MFJ, 2026, "AZ", 120_000, capital_loss_carryforward=4_000)
    r = simulate(sale, ctx)
    assert r.raw_gain == 10_000.0
    assert r.adjusted_gain == 6_000.0
    assert r.impact.losses_applied == 4_000.0


def test_content_packs_present_and_versioned():
    root = Path(__file__).resolve().parent.parent / "content"
    for name in ("federal-2026", "states-2026", "ocr-field-maps"):
        pack = json.loads((root / f"{name}.json").read_text())
        assert pack["version"], name
    maps = json.loads((root / "ocr-field-maps.json").read_text())["maps"]
    assert set(maps) == {"w2", "payslip", "hsa_statement", "401k_statement", "1099b", "1098t", "1099q",
                         "brokerage_statement", "529_statement"}
