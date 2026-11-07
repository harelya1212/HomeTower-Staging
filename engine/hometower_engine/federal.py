"""Federal tax math. Ported from hct federal_calculator.py; constants moved
to the federal content pack. NIIT is computed here (the prototype defined
the constants at this level but applied NIIT in its services)."""
from dataclasses import dataclass

from .packs import federal_pack, _brackets

DEFAULT_STATUS = "married_filing_jointly"


def _ordinary_brackets(filing_status: str, pack: dict) -> list:
    raw = pack["ordinary_brackets"].get(filing_status) or pack["ordinary_brackets"][DEFAULT_STATUS]
    return _brackets(raw)


def _ltcg_brackets(filing_status: str, pack: dict) -> list:
    raw = pack["ltcg_brackets"].get(filing_status) or pack["ltcg_brackets"][DEFAULT_STATUS]
    return _brackets(raw)


def compute_ordinary_tax(taxable_income: float, filing_status: str, pack: dict | None = None) -> float:
    pack = pack or federal_pack()
    tax = 0.0
    for low, high, rate in _ordinary_brackets(filing_status, pack):
        if taxable_income <= low:
            break
        tax += (min(taxable_income, high) - low) * rate
    return tax


def compute_ltcg_tax(ltcg_amount: float, taxable_income_before_ltcg: float,
                     filing_status: str, pack: dict | None = None) -> float:
    """Stacking: the gain fills the LTCG brackets above ordinary income."""
    pack = pack or federal_pack()
    tax = 0.0
    base = taxable_income_before_ltcg
    remaining = ltcg_amount
    for low, high, rate in _ltcg_brackets(filing_status, pack):
        space = max(0.0, min(high, base + remaining) - max(low, base))
        if space > 0:
            tax += space * rate
    return tax


def marginal_rate(taxable_income: float, filing_status: str, pack: dict | None = None) -> float:
    pack = pack or federal_pack()
    for low, high, rate in _ordinary_brackets(filing_status, pack):
        if low <= taxable_income < high:
            return rate
    return 0.37


def distance_to_next_bracket(taxable_income: float, filing_status: str,
                             pack: dict | None = None) -> tuple[float, float]:
    pack = pack or federal_pack()
    for low, high, rate in _ordinary_brackets(filing_status, pack):
        if low <= taxable_income < high:
            if high == float("inf"):
                return 0.0, rate
            return high - taxable_income, rate
    return 0.0, 0.37


def compute_niit(magi: float, net_investment_income: float, filing_status: str,
                 pack: dict | None = None) -> float:
    pack = pack or federal_pack()
    threshold = pack["niit"]["threshold"].get(filing_status, 250_000)
    if magi <= threshold or net_investment_income <= 0:
        return 0.0
    return min(net_investment_income, magi - threshold) * pack["niit"]["rate"]


@dataclass
class FederalTaxResult:
    gross_income: float
    standard_deduction: float
    taxable_income: float
    ordinary_tax: float
    ltcg_tax: float
    total_tax: float
    effective_rate: float
    marginal_rate: float
    distance_to_next_bracket: float
    next_bracket_rate: float


def compute_federal_tax(gross_income: float, filing_status: str, ltcg_income: float = 0.0,
                        itemized_deductions: float = 0.0, pack: dict | None = None) -> FederalTaxResult:
    pack = pack or federal_pack()
    std = pack["standard_deduction"].get(filing_status, 30_750)
    deduction = max(std, itemized_deductions)
    taxable_income = max(0.0, gross_income - deduction)
    ordinary_taxable = max(0.0, taxable_income - ltcg_income)
    ordinary_tax = compute_ordinary_tax(ordinary_taxable, filing_status, pack)
    ltcg_tax = compute_ltcg_tax(ltcg_income, ordinary_taxable, filing_status, pack) if ltcg_income > 0 else 0.0
    total = ordinary_tax + ltcg_tax
    dist, next_rate = distance_to_next_bracket(ordinary_taxable, filing_status, pack)
    return FederalTaxResult(
        gross_income=gross_income,
        standard_deduction=deduction,
        taxable_income=taxable_income,
        ordinary_tax=ordinary_tax,
        ltcg_tax=ltcg_tax,
        total_tax=total,
        effective_rate=total / gross_income if gross_income > 0 else 0.0,
        marginal_rate=marginal_rate(ordinary_taxable, filing_status, pack),
        distance_to_next_bracket=dist,
        next_bracket_rate=next_rate,
    )
