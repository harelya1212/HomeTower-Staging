"""Household snapshot and what-if scenarios.

Ported from hct tax_engine/service.py and tax_simulator/service.py.
Audit fixes applied:
- the prototype's `change_withholding` action was accepted but never
  applied; here it changes federal withholding and the refund/owe moves.
- state tax remains the Arizona flat model from the prototype (Phase 1
  state); other states are rejected loudly instead of silently taxed as AZ.
"""
from dataclasses import dataclass
from typing import Optional

from .federal import (compute_additional_medicare, compute_federal_tax,
                      compute_niit, niit_breakdown)
from .state import compute_arizona_tax


@dataclass
class HouseholdTaxSnapshot:
    filing_status: str
    gross_income: float
    ltcg_income: float
    federal_withholding_ytd: float
    state_withholding_ytd: float
    federal_tax: float
    federal_refund_owe: float
    state_tax: float
    state_refund_owe: float
    niit: float
    total_tax: float
    effective_rate: float
    marginal_rate: float
    distance_to_next_bracket: float
    next_bracket_rate: float
    # Engine round 45 - the federal reconciliation, shown not hidden.
    # federal_tax stays the INCOME tax (the gauge bug of round 44 was
    # conflating it with the all-in figure); total_federal_liability
    # adds NIIT + Additional Medicare liability; total_federal_payments
    # adds the Additional-Medicare withheld credit to Box-2
    # withholding; federal_refund_owe = payments - liability, which
    # reduces to withholding - (income tax + NIIT + AddMed NET).
    additional_medicare_liability: float = 0.0
    additional_medicare_withheld: float = 0.0
    additional_medicare_net: float = 0.0
    federal_credits: float = 0.0
    total_federal_liability: float = 0.0
    total_federal_payments: float = 0.0
    niit_nii_subject: float = 0.0
    niit_magi_excess: float = 0.0
    niit_base: float = 0.0
    medicare_included: bool = False


def compute_household_tax(filing_status: str, gross_income: float,
                          federal_withholding_ytd: float = 0.0,
                          state_withholding_ytd: float = 0.0,
                          ltcg_income: float = 0.0,
                          magi: Optional[float] = None,
                          net_investment_income: float = 0.0,
                          itemized_deductions: float = 0.0,
                          state: str = "AZ",
                          medicare_wages_by_earner: Optional[list] = None,
                          medicare_withheld_by_earner: Optional[list] = None,
                          federal_credits: float = 0.0) -> HouseholdTaxSnapshot:
    if state.upper() != "AZ":
        raise ValueError(
            f"Snapshot state model is Arizona only in Phase 1 (got {state}). "
            "Full state packs arrive per PHASE1.md sequencing.")
    federal = compute_federal_tax(gross_income, filing_status, ltcg_income, itemized_deductions)
    magi_value = magi or gross_income
    nb = niit_breakdown(magi_value, net_investment_income, filing_status)
    niit = nb.niit
    state_tax = compute_arizona_tax(gross_income)
    # Additional Medicare enters only when Medicare data is supplied
    # (round 45): absent data keeps every pre-45 figure untouched.
    medicare_included = medicare_wages_by_earner is not None
    if medicare_included:
        am = compute_additional_medicare(medicare_wages_by_earner,
                                         medicare_withheld_by_earner or [],
                                         filing_status)
        am_liability, am_withheld, am_net = am.liability, am.withheld_credit, am.net
    else:
        am_liability = am_withheld = am_net = 0.0
    total_federal_liability = federal.total_tax + niit + am_liability - federal_credits
    total_federal_payments = federal_withholding_ytd + am_withheld
    return HouseholdTaxSnapshot(
        filing_status=filing_status,
        gross_income=gross_income,
        ltcg_income=ltcg_income,
        federal_withholding_ytd=federal_withholding_ytd,
        state_withholding_ytd=state_withholding_ytd,
        federal_tax=federal.total_tax,
        federal_refund_owe=total_federal_payments - total_federal_liability,
        state_tax=state_tax,
        state_refund_owe=state_withholding_ytd - state_tax,
        niit=niit,
        total_tax=federal.total_tax + niit + state_tax,
        effective_rate=federal.effective_rate,
        marginal_rate=federal.marginal_rate,
        distance_to_next_bracket=federal.distance_to_next_bracket,
        next_bracket_rate=federal.next_bracket_rate,
        additional_medicare_liability=am_liability,
        additional_medicare_withheld=am_withheld,
        additional_medicare_net=am_net,
        federal_credits=federal_credits,
        total_federal_liability=total_federal_liability,
        total_federal_payments=total_federal_payments,
        niit_nii_subject=nb.nii_subject,
        niit_magi_excess=nb.magi_excess,
        niit_base=nb.base,
        medicare_included=medicare_included,
    )


@dataclass
class ScenarioInput:
    filing_status: str
    base_income: float
    federal_withholding_ytd: float
    state_withholding_ytd: float
    action: str  # increase_401k | change_hsa | roth_conversion | change_withholding
    delta_amount: float


def simulate_scenario(inp: ScenarioInput) -> dict:
    base = compute_household_tax(inp.filing_status, inp.base_income,
                                 inp.federal_withholding_ytd, inp.state_withholding_ytd)
    modified_income = inp.base_income
    modified_withholding = inp.federal_withholding_ytd
    if inp.action == "increase_401k":
        modified_income -= inp.delta_amount
    elif inp.action == "change_hsa":
        modified_income -= inp.delta_amount
    elif inp.action == "roth_conversion":
        modified_income += inp.delta_amount
    elif inp.action == "change_withholding":
        modified_withholding += inp.delta_amount
    else:
        raise ValueError(f"Unknown scenario action: {inp.action}")
    modified = compute_household_tax(inp.filing_status, modified_income,
                                     modified_withholding, inp.state_withholding_ytd)
    return {
        "base_federal_tax": round(base.federal_tax, 2),
        "modified_federal_tax": round(modified.federal_tax, 2),
        "federal_tax_delta": round(modified.federal_tax - base.federal_tax, 2),
        "base_refund_owe": round(base.federal_refund_owe, 2),
        "modified_refund_owe": round(modified.federal_refund_owe, 2),
        "marginal_rate_pct": round(modified.marginal_rate * 100, 1),
        "action": inp.action,
        "delta_amount": inp.delta_amount,
    }
