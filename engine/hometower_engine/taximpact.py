"""TaxImpact: full tax consequence of a planned asset sale.

Ported from hct investment_simulator/service.py with the audit fixes:
- the timing comparison used an undefined variable (magi_value) and crashed
  every short-term-gain simulation with NameError; it now uses magi_with_gain.
- the bracket-alert walrus condition was replaced with a plain comparison.
"""
from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional

from .federal import (compute_ltcg_tax, compute_niit, compute_ordinary_tax,
                      distance_to_next_bracket, marginal_rate)
from .packs import federal_pack
from .state import compute_state_tax_on_gain
from .wash_sale import TaxLot, WashSaleResult, check_wash_sale

LTCG_HOLDING_DAYS = 365


@dataclass
class SaleInput:
    ticker: str
    broker: str
    quantity: float
    cost_basis_per_share: float
    sale_price_per_share: float
    purchase_date: date
    sale_date: date
    lot_selection: str = "fifo"          # fifo | lifo | min_tax | specific_id
    acquisition_type: str = "purchased"  # purchased | espp | rso | gift | inherited


@dataclass
class SimulationContext:
    filing_status: str
    tax_year: int
    state: str
    estimated_ordinary_income: float
    federal_withholding_ytd: float = 0.0
    state_withholding_ytd: float = 0.0
    realized_st_gains_ytd: float = 0.0
    realized_lt_gains_ytd: float = 0.0
    capital_loss_carryforward: float = 0.0
    magi: Optional[float] = None
    net_investment_income_ytd: float = 0.0
    existing_lots: List[TaxLot] = field(default_factory=list)


@dataclass
class TaxImpact:
    gain_amount: float
    is_long_term: bool
    days_held: int
    federal_tax: float
    niit: float
    state_tax: float
    total_tax_impact: float
    effective_tax_rate: float
    net_proceeds: float
    net_profit: float
    after_tax_return_pct: float
    marginal_bracket: float
    enters_higher_bracket: bool
    distance_to_next_bracket: float
    next_bracket_rate: float
    losses_applied: float
    wash_sale: WashSaleResult


@dataclass
class TimingComparison:
    tax_if_sold_now_st: float
    tax_if_sold_later_lt: float
    tax_savings_by_waiting: float
    days_until_long_term: int
    break_even_explanation: str


@dataclass
class SimulationResult:
    sale: SaleInput
    context: SimulationContext
    gross_proceeds: float
    raw_gain: float
    adjusted_gain: float
    impact: TaxImpact
    timing: Optional[TimingComparison]
    bracket_alert: str
    summary: str


def _federal_tax_on_gain(gain: float, is_long_term: bool, ordinary_income: float,
                         filing_status: str, pack: dict) -> float:
    std_deduction = pack["standard_deduction"].get(filing_status, 30_750)
    taxable_ordinary = max(0.0, ordinary_income - std_deduction)
    if is_long_term:
        return compute_ltcg_tax(max(0.0, gain), taxable_ordinary, filing_status, pack)
    tax_without = compute_ordinary_tax(taxable_ordinary, filing_status, pack)
    tax_with = compute_ordinary_tax(taxable_ordinary + max(0.0, gain), filing_status, pack)
    return max(0.0, tax_with - tax_without)


def simulate(sale: SaleInput, ctx: SimulationContext, pack: dict | None = None) -> SimulationResult:
    pack = pack or federal_pack(ctx.tax_year)
    days_held = (sale.sale_date - sale.purchase_date).days
    is_long_term = days_held > LTCG_HOLDING_DAYS

    gross_proceeds = sale.sale_price_per_share * sale.quantity
    raw_gain = (sale.sale_price_per_share - sale.cost_basis_per_share) * sale.quantity

    wash = check_wash_sale(
        sale_ticker=sale.ticker,
        sale_date=sale.sale_date,
        loss_per_share=sale.sale_price_per_share - sale.cost_basis_per_share,
        quantity_sold=sale.quantity,
        existing_lots=ctx.existing_lots,
    )

    effective_gain = raw_gain
    if wash.triggered:
        effective_gain = 0.0  # loss disallowed by IRS

    losses_applied = 0.0
    adjusted_gain = effective_gain
    if effective_gain > 0 and ctx.capital_loss_carryforward > 0:
        losses_applied = min(effective_gain, ctx.capital_loss_carryforward)
        adjusted_gain = effective_gain - losses_applied

    base_magi = ctx.magi or ctx.estimated_ordinary_income
    magi_with_gain = base_magi + max(0.0, adjusted_gain)
    net_inv = ctx.net_investment_income_ytd + max(0.0, adjusted_gain)

    federal_tax = _federal_tax_on_gain(adjusted_gain, is_long_term, ctx.estimated_ordinary_income,
                                       ctx.filing_status, pack)
    niit = compute_niit(magi_with_gain, net_inv, ctx.filing_status, pack) if adjusted_gain > 0 else 0.0
    state_tax = compute_state_tax_on_gain(max(0.0, adjusted_gain), ctx.state, is_long_term=is_long_term,
                                          ordinary_income=ctx.estimated_ordinary_income).tax
    total_tax = federal_tax + niit + state_tax
    effective_rate = total_tax / adjusted_gain if adjusted_gain > 0 else 0.0
    net_proceeds = gross_proceeds - total_tax
    net_profit = adjusted_gain - total_tax
    after_tax_return = net_profit / (sale.cost_basis_per_share * sale.quantity) if sale.cost_basis_per_share > 0 else 0.0

    std_ded = pack["standard_deduction"].get(ctx.filing_status, 30_750)
    taxable_ordinary = max(0.0, ctx.estimated_ordinary_income - std_ded)
    m_rate = marginal_rate(taxable_ordinary, ctx.filing_status, pack)
    dist, next_rate = distance_to_next_bracket(taxable_ordinary, ctx.filing_status, pack)
    enters_higher = (adjusted_gain > dist) and not is_long_term

    timing = None
    days_until_lt = LTCG_HOLDING_DAYS - days_held
    if not is_long_term and adjusted_gain > 0:
        tax_st = federal_tax + niit + state_tax
        lt_federal = _federal_tax_on_gain(adjusted_gain, True, ctx.estimated_ordinary_income,
                                          ctx.filing_status, pack)
        lt_niit = compute_niit(magi_with_gain, net_inv, ctx.filing_status, pack)
        lt_state = compute_state_tax_on_gain(adjusted_gain, ctx.state, is_long_term=True,
                                             ordinary_income=ctx.estimated_ordinary_income).tax
        tax_lt = lt_federal + lt_niit + lt_state
        savings = tax_st - tax_lt
        timing = TimingComparison(
            tax_if_sold_now_st=round(tax_st, 2),
            tax_if_sold_later_lt=round(tax_lt, 2),
            tax_savings_by_waiting=round(savings, 2),
            days_until_long_term=max(0, days_until_lt),
            break_even_explanation=(
                f"Waiting {max(0, days_until_lt)} more days saves ${savings:,.2f} in taxes "
                f"by converting to long-term capital gains."
            ) if savings > 0 else "Holding longer provides no additional tax benefit.",
        )

    if wash.triggered:
        bracket_alert = "RED"
    elif enters_higher:
        bracket_alert = "YELLOW"
    elif effective_rate * 100 > 25:
        bracket_alert = "YELLOW"
    else:
        bracket_alert = "GREEN"

    summary = (
        f"{'LT' if is_long_term else 'ST'} gain of ${adjusted_gain:,.2f} on {sale.ticker}. "
        f"Total tax impact: ${total_tax:,.2f} "
        f"({round(effective_rate * 100, 1)}% effective). "
        f"Net proceeds: ${net_proceeds:,.2f}."
    )
    if wash.triggered:
        summary = f"WASH SALE ALERT - {wash.explanation} " + summary

    return SimulationResult(
        sale=sale,
        context=ctx,
        gross_proceeds=round(gross_proceeds, 2),
        raw_gain=round(raw_gain, 2),
        adjusted_gain=round(adjusted_gain, 2),
        impact=TaxImpact(
            gain_amount=round(adjusted_gain, 2),
            is_long_term=is_long_term,
            days_held=days_held,
            federal_tax=round(federal_tax, 2),
            niit=round(niit, 2),
            state_tax=round(state_tax, 2),
            total_tax_impact=round(total_tax, 2),
            effective_tax_rate=round(effective_rate, 4),
            net_proceeds=round(net_proceeds, 2),
            net_profit=round(net_profit, 2),
            after_tax_return_pct=round(after_tax_return * 100, 2),
            marginal_bracket=round(m_rate * 100, 1),
            enters_higher_bracket=enters_higher,
            distance_to_next_bracket=round(dist, 2),
            next_bracket_rate=round(next_rate * 100, 1),
            losses_applied=round(losses_applied, 2),
            wash_sale=wash,
        ),
        timing=timing,
        bracket_alert=bracket_alert,
        summary=summary,
    )
