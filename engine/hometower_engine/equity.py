"""Equity compensation: RSU vesting and ESPP dispositions (Phase 1, in
full per the owner decision of 2026-11-07).

RSU: at vest, shares x FMV is ordinary wage income. Employers withhold
federal tax at the 22% supplemental rate (37% above $1M of supplemental
wages in a year). The gap between what was withheld and the tax the vest
actually adds inside the household projection is the number households
get surprised by at filing; this module projects it.

ESPP (IRC 423): a disposition is QUALIFYING when the shares are held
more than 2 years after the grant date AND more than 1 year after the
purchase date; otherwise DISQUALIFYING.
- Disqualifying: ordinary income = purchase-date FMV - purchase price,
  recognised in the sale year; basis = purchase price + ordinary income.
- Qualifying: ordinary income = the lesser of the grant-date discount
  (grant FMV - purchase price) and the actual gain (sale price - purchase
  price); if the sale is at a loss, ordinary income is 0. Basis = purchase
  price + ordinary income; the rest is capital gain/loss, long-term by
  construction of the holding tests.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional

from .federal import compute_federal_tax

SUPPLEMENTAL_RATE = 0.22
SUPPLEMENTAL_HIGH_RATE = 0.37
SUPPLEMENTAL_HIGH_THRESHOLD = 1_000_000.0


@dataclass
class RsuVestResult:
    shares: float
    fmv_at_vest: float
    ordinary_income: float
    federal_withheld: float
    projected_additional_tax: float
    projected_gap: float  # additional tax still owed (+) or excess withheld (-)
    lot_basis_per_share: float
    holding_start: date


def rsu_vest(shares: float, fmv_at_vest: float, vest_date: date,
             filing_status: str, other_gross_income: float,
             supplemental_wages_ytd_before: float = 0.0,
             pack: dict | None = None) -> RsuVestResult:
    income = shares * fmv_at_vest
    # Withholding: 22% up to the $1M supplemental threshold, 37% above it.
    room_at_22 = max(0.0, SUPPLEMENTAL_HIGH_THRESHOLD - supplemental_wages_ytd_before)
    at_22 = min(income, room_at_22)
    withheld = at_22 * SUPPLEMENTAL_RATE + (income - at_22) * SUPPLEMENTAL_HIGH_RATE
    base_tax = compute_federal_tax(other_gross_income, filing_status, pack=pack).total_tax
    with_tax = compute_federal_tax(other_gross_income + income, filing_status, pack=pack).total_tax
    additional = with_tax - base_tax
    return RsuVestResult(
        shares=shares,
        fmv_at_vest=fmv_at_vest,
        ordinary_income=round(income, 2),
        federal_withheld=round(withheld, 2),
        projected_additional_tax=round(additional, 2),
        projected_gap=round(additional - withheld, 2),
        lot_basis_per_share=fmv_at_vest,
        holding_start=vest_date,
    )


@dataclass
class EsppResult:
    classification: str  # qualifying | disqualifying
    shares: float
    ordinary_income_total: float
    basis_per_share: float
    capital_gain_total: float
    capital_is_long_term: bool


def espp_disposition(shares: float, grant_date: date, grant_fmv: float,
                     purchase_date: date, purchase_fmv: float, purchase_price: float,
                     sale_date: date, sale_price: float) -> EsppResult:
    qualifying = (sale_date - grant_date).days > 730 and (sale_date - purchase_date).days > 365
    actual_gain_per_share = sale_price - purchase_price
    if qualifying:
        grant_discount = grant_fmv - purchase_price
        ordinary_per_share = 0.0 if actual_gain_per_share < 0 else min(grant_discount, actual_gain_per_share)
        is_lt = True
    else:
        ordinary_per_share = purchase_fmv - purchase_price
        is_lt = (sale_date - purchase_date).days > 365
    basis_per_share = purchase_price + ordinary_per_share
    capital_per_share = sale_price - basis_per_share
    return EsppResult(
        classification="qualifying" if qualifying else "disqualifying",
        shares=shares,
        ordinary_income_total=round(ordinary_per_share * shares, 2),
        basis_per_share=round(basis_per_share, 2),
        capital_gain_total=round(capital_per_share * shares, 2),
        capital_is_long_term=is_lt,
    )
