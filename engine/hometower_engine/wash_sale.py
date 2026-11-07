"""Wash sale detection. Ported from hct wash_sale.py.

IRS rule: sell at a loss and buy the same (or substantially identical)
security within 30 days before OR after the sale, and the loss is
disallowed; it is added to the cost basis of the replacement lot.

Limits (documented in the prototype, kept explicit): exact ticker match
only, and the disallowance is computed in full against the first matching
replacement lot, not proportionally per replaced share.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from typing import List


@dataclass
class TaxLot:
    ticker: str
    broker: str
    quantity: float
    purchase_date: date
    cost_basis_per_share: float


@dataclass
class WashSaleResult:
    triggered: bool
    disallowed_loss: float
    adjusted_basis_per_share: float
    replacement_lot_ticker: str
    replacement_lot_broker: str
    replacement_lot_date: date
    explanation: str


WINDOW_DAYS = 30


def _is_substantially_identical(ticker_a: str, ticker_b: str) -> bool:
    return ticker_a.upper() == ticker_b.upper()


def check_wash_sale(sale_ticker: str, sale_date: date, loss_per_share: float,
                    quantity_sold: float, existing_lots: List[TaxLot]) -> WashSaleResult:
    no_wash = WashSaleResult(False, 0.0, 0.0, sale_ticker, "", sale_date, "No wash sale triggered.")
    if loss_per_share >= 0:
        return no_wash

    window_start = sale_date - timedelta(days=WINDOW_DAYS)
    window_end = sale_date + timedelta(days=WINDOW_DAYS)

    replacement = None
    for lot in existing_lots:
        if not _is_substantially_identical(sale_ticker, lot.ticker):
            continue
        if lot.purchase_date == sale_date:
            continue
        if window_start <= lot.purchase_date <= window_end:
            replacement = lot
            break

    if replacement is None:
        return no_wash

    total_loss = loss_per_share * quantity_sold
    disallowed = abs(total_loss)
    adjusted_basis = replacement.cost_basis_per_share + (disallowed / replacement.quantity)
    return WashSaleResult(
        triggered=True,
        disallowed_loss=disallowed,
        adjusted_basis_per_share=round(adjusted_basis, 4),
        replacement_lot_ticker=replacement.ticker,
        replacement_lot_broker=replacement.broker,
        replacement_lot_date=replacement.purchase_date,
        explanation=(
            f"Wash sale triggered: loss of ${disallowed:,.2f} is disallowed. "
            f"Your replacement lot ({replacement.ticker} @ {replacement.broker}, "
            f"purchased {replacement.purchase_date}) basis is adjusted to "
            f"${adjusted_basis:.4f}/share."
        ),
    )
