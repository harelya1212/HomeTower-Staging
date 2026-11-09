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

from hometower_engine.federal import (compute_additional_medicare,
                                      compute_federal_tax, compute_ltcg_tax,
                                      compute_niit, niit_breakdown)
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


# Engine round 45 - Additional Medicare Tax + NIIT base breakdown.
# Expected values are hand arithmetic on IRC 3101(b)(2) / IRC 1411,
# independent of the implementation (same figures as the TS vectors).

def test_r45_addmed_mfj_under_250k():
    # Household Medicare wages 200K < 250K MFJ threshold: no liability.
    r = compute_additional_medicare([120_000, 80_000], [1_740, 1_160], MFJ)
    assert (r.liability, r.withheld_credit, r.net) == (0.0, 0.0, 0.0)


def test_r45_addmed_mfj_one_over_200k():
    # Liability: 0.9% x (400K - 250K) = 1,350. Credit: only earner 1
    # crossed the $200K employer line: 5,115 - 1.45% x 300K = 765.
    r = compute_additional_medicare([300_000, 100_000], [5_115, 1_450], MFJ)
    assert (r.liability, r.withheld_credit, r.net) == (1_350.0, 765.0, 585.0)


def test_r45_addmed_mfj_both_under_but_over():
    # THE trap case: neither earner over $200K (employer withheld no
    # extra 0.9%), household over $250K: full 540 is still owed.
    r = compute_additional_medicare([180_000, 130_000], [2_610, 1_885], MFJ)
    assert (r.liability, r.withheld_credit, r.net) == (540.0, 0.0, 540.0)


def test_r45_addmed_mfj_both_over_200k():
    r = compute_additional_medicare([250_000, 250_000], [4_075, 4_075], MFJ)
    # credit per earner: 4,075 - 1.45% x 250K = 450; x2 = 900; net 1,350
    assert (r.liability, r.withheld_credit, r.net) == (2_250.0, 900.0, 1_350.0)


def test_r45_addmed_bonus_only():
    # Bonus-only payroll: YTD Medicare wages 55K, employer withheld
    # the 0.9% on the 45K of the bonus above the $200K line... the
    # earner's full wages here are the 55K bonus on top of 200K of
    # regular wages - modelled as wages 255K per the return test.
    r = compute_additional_medicare([255_000, 50_000], [4_147.50, 725.0], MFJ)
    assert r.liability == 495.0 and r.withheld_credit == 450.0 and r.net == 45.0


def test_r45_addmed_wages_vs_box1():
    # Single filer: liability runs on MEDICARE wages (320K), over the
    # $200K single threshold - not on the (smaller) Box 1 wages.
    r = compute_additional_medicare([320_000], [5_720], "single")
    # liability 0.9% x (320K - 200K) = 1,080; credit 5,720 - 1.45% x 320K
    # = 1,080; a single earner withheld exactly per statute nets to 0
    assert (r.liability, r.withheld_credit, r.net) == (1_080.0, 1_080.0, 0.0)


def test_r45_niit_breakdown_cases():
    b = niit_breakdown(240_000, 50_000, MFJ)   # MAGI under threshold
    assert (b.nii_subject, b.magi_excess, b.base, b.niit) == (50_000.0, 0.0, 0.0, 0.0)
    b = niit_breakdown(300_000, 0, MFJ)        # MAGI over, NII = 0
    assert (b.nii_subject, b.magi_excess, b.base, b.niit) == (0.0, 50_000.0, 0.0, 0.0)
    b = niit_breakdown(350_000, 20_000, MFJ)   # gains net of loss carryforward
    assert (b.base, b.niit) == (20_000.0, 760.0)
    b = niit_breakdown(350_000, 15_000, MFJ)   # interest/dividends only
    assert (b.base, b.niit) == (15_000.0, 570.0)
    b = niit_breakdown(270_000, 80_000, MFJ)   # base limited by MAGI excess
    assert (b.base, b.niit) == (20_000.0, 760.0)
    b = niit_breakdown(400_000, 10_000, MFJ)   # base limited by NII
    assert (b.base, b.niit) == (10_000.0, 380.0)


def test_r45_snapshot_reconciliation():
    # income tax 73,468.00 (2,480 + 9,120 + 24,332 + 37,536 on
    # taxable 367,800) + AddMed liability 1,350;
    # payments 140,000 Box-2 + 765 AddMed withheld; refund = 65,947.00.
    snap = compute_household_tax(
        MFJ, 400_000, federal_withholding_ytd=140_000,
        medicare_wages_by_earner=[300_000, 100_000],
        medicare_withheld_by_earner=[5_115, 1_450])
    assert snap.federal_tax == 73_468.0
    assert snap.additional_medicare_liability == 1_350.0
    assert snap.additional_medicare_withheld == 765.0
    assert snap.additional_medicare_net == 585.0
    assert snap.total_federal_liability == 74_818.0
    assert snap.total_federal_payments == 140_765.0
    assert snap.federal_refund_owe == 65_947.0
    assert snap.medicare_included is True
    # Without Medicare data every pre-45 figure is untouched.
    plain = compute_household_tax(MFJ, 400_000, federal_withholding_ytd=140_000)
    assert plain.medicare_included is False
    assert plain.federal_refund_owe == 140_000 - 73_468.0


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
                         "brokerage_statement", "529_statement", "prior_return", "pension_statement", "other"}
