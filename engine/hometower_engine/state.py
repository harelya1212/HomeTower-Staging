"""State tax on a capital gain (TaxImpact helper). Ported from hct
state_calculator.py; rates live in the states content pack.

Scope limit, stated plainly: this is NOT a full state income-tax projection.
Progressive states use a single effective rate at ~$250K household income
and results carry that approximation note.
"""
from dataclasses import dataclass

from .packs import states_pack


@dataclass
class StateTaxResult:
    state: str
    tax: float
    rate_applied: float
    note: str


def compute_state_tax_on_gain(gain: float, state: str, is_long_term: bool = True,
                              ordinary_income: float = 0.0, pack: dict | None = None) -> StateTaxResult:
    pack = pack or states_pack()
    state = state.upper()
    if gain <= 0:
        return StateTaxResult(state, 0.0, 0.0, "No taxable gain.")

    if state in pack["no_income_tax_states"]:
        return StateTaxResult(state, 0.0, 0.0, f"{state} has no state income tax.")

    special = pack.get("special", {})
    if state == "WA":
        wa = special["WA"]
        if is_long_term and gain > wa["ltcg_threshold"]:
            tax = (gain - wa["ltcg_threshold"]) * wa["ltcg_rate"]
            return StateTaxResult(state, round(tax, 2), wa["ltcg_rate"],
                                  f"WA 7% capital gains tax on gains above ${wa['ltcg_threshold']:,}.")
        return StateTaxResult(state, 0.0, 0.0, "WA capital gains tax only applies to LT gains above threshold.")
    if state == "MA":
        ma = special["MA"]
        rate = ma["lt_rate"] if is_long_term else ma["st_rate"]
        return StateTaxResult(state, round(gain * rate, 2), rate,
                              f"MA {'5% long-term' if is_long_term else '8.5% short-term'} capital gains rate.")

    if state in pack["flat_rates"]:
        rate = pack["flat_rates"][state]
        return StateTaxResult(state, round(gain * rate, 2), rate,
                              f"{state} flat income tax rate {rate * 100:.2f}%.")

    if state in pack["progressive_effective_rates"]:
        rate = pack["progressive_effective_rates"][state]
        note = (f"{state} effective rate ~{rate * 100:.2f}% at this income level. "
                f"Note: approximate - full bracket table recommended for production.")
        return StateTaxResult(state, round(gain * rate, 2), rate, note)

    return StateTaxResult(state, 0.0, 0.0,
                          f"State '{state}' not yet in database. Tax defaulted to $0 - verify manually.")


def compute_arizona_tax(arizona_agi: float, pack: dict | None = None) -> float:
    """Arizona flat tax. Ported from hct arizona_calculator.py (folded in per
    the audit). Simplification carried from the prototype: applies the flat
    rate to AZ AGI with no AZ-specific subtraction or deduction modelling."""
    pack = pack or states_pack()
    return max(0.0, arizona_agi * pack["flat_rates"]["AZ"])


def state_tax_model_info(state: str) -> dict:
    """ROUND 60 (P1-A) - what the state model IS, stated by the
    engine itself (mirror of the TS helper): for Arizona, AGI x
    the 2.5% flat rate with NO Form 140 logic - no standard
    deduction, additions/subtractions, dependent/school/charitable
    credits or prior-year adjustments. A planning estimate; the
    state domain's accuracy is capped until a full Form 140 model
    exists."""
    state = state.upper()
    if state == "AZ":
        parts = ["Arizona projection", "Planning estimate", "Flat-rate approximation",
                 "Full Arizona return adjustments not yet modeled"]
        return {"state": state, "model_kind": "flat_rate_approximation",
                "full_return_modeled": False, "label_parts": parts, "label": " - ".join(parts)}
    return {"state": state, "model_kind": "full_return", "full_return_modeled": True,
            "label_parts": [], "label": ""}
