"""Foreign accounts and income (Phase 1, in full per the owner decision
of 2026-11-07): filing tests and the foreign tax credit limitation.
Treaty-by-treaty detail stays deferred (PHASE1.md).

FBAR (FinCEN Form 114): a US person with a financial interest in or
signature authority over foreign financial accounts must file when the
AGGREGATE maximum balances exceed $10,000 at any moment in the year.

Form 8938 (FATCA): specified foreign financial assets above thresholds
that depend on filing status and residence:
- Living in the US: single $50,000 on the last day / $75,000 at any time;
  MFJ $100,000 / $150,000.
- Living abroad: single $200,000 / $300,000; MFJ $400,000 / $600,000.

Foreign tax credit (Form 1116, simplified to one basket): the credit is
the lesser of creditable foreign taxes paid and the limitation -
US tax x (foreign-source taxable income / total taxable income).
Excess credit carries back 1 year and forward 10 years (noted, not
modelled year-by-year here).
"""
from dataclasses import dataclass

FBAR_THRESHOLD = 10_000.0

_8938_THRESHOLDS = {
    # (living_abroad, filing_status) -> (last_day, any_time)
    (False, "single"): (50_000.0, 75_000.0),
    (False, "head_of_household"): (50_000.0, 75_000.0),
    (False, "married_filing_jointly"): (100_000.0, 150_000.0),
    (False, "married_filing_separately"): (50_000.0, 75_000.0),
    (True, "single"): (200_000.0, 300_000.0),
    (True, "head_of_household"): (200_000.0, 300_000.0),
    (True, "married_filing_jointly"): (400_000.0, 600_000.0),
    (True, "married_filing_separately"): (200_000.0, 300_000.0),
}


@dataclass
class FilingTest:
    required: bool
    reason: str


def fbar_required(max_balances_by_account: list[float]) -> FilingTest:
    aggregate = sum(max_balances_by_account)
    if aggregate > FBAR_THRESHOLD:
        return FilingTest(True, f"Aggregate maximum foreign account balance ${aggregate:,.2f} exceeds $10,000 - FBAR (FinCEN 114) filing required.")
    return FilingTest(False, f"Aggregate maximum foreign account balance ${aggregate:,.2f} does not exceed $10,000 - no FBAR filing required.")


def form_8938_required(total_value_last_day: float, total_value_max_any_time: float,
                       filing_status: str, living_abroad: bool = False) -> FilingTest:
    key = (living_abroad, filing_status)
    if key not in _8938_THRESHOLDS:
        raise ValueError(f"Unknown filing status: {filing_status}")
    last_day_t, any_time_t = _8938_THRESHOLDS[key]
    if total_value_last_day > last_day_t or total_value_max_any_time > any_time_t:
        return FilingTest(True, f"Specified foreign financial assets exceed the 8938 threshold (${last_day_t:,.0f} last day / ${any_time_t:,.0f} any time) - Form 8938 required.")
    return FilingTest(False, f"Specified foreign financial assets are within the 8938 thresholds (${last_day_t:,.0f} last day / ${any_time_t:,.0f} any time) - Form 8938 not required.")


@dataclass
class FtcResult:
    foreign_taxes_paid: float
    limitation: float
    credit_allowed: float
    excess_credit: float  # carries back 1 year, then forward up to 10 years


def foreign_tax_credit(foreign_taxes_paid: float, foreign_source_taxable_income: float,
                       total_taxable_income: float, us_tax_before_credits: float) -> FtcResult:
    if total_taxable_income <= 0:
        limitation = 0.0
    else:
        limitation = us_tax_before_credits * (foreign_source_taxable_income / total_taxable_income)
    credit = min(foreign_taxes_paid, max(0.0, limitation))
    return FtcResult(
        foreign_taxes_paid=round(foreign_taxes_paid, 2),
        limitation=round(limitation, 2),
        credit_allowed=round(credit, 2),
        excess_credit=round(foreign_taxes_paid - credit, 2),
    )
