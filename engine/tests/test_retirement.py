"""Round 53 Python parity: the dual-source retirement resolution.

The same cases as the TypeScript suite (app/src/goals.ts, tested by
app/engine-tests/round52.ts GT6 / AC-D1 / AC-D3 / AC-D4), proven
against the reference implementation in hometower_engine.retirement:
payslip wins over statement; the statement fallback derives $500/mo
from $1,500 over the statement's own 3 months; an unowned statement
is never used; no source is a distinct UNKNOWN - monthly is None,
never 0.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hometower_engine.retirement import (
    adult_starting_balance,
    employer_match_for,
    k401_statement_match_for,
    statement_period_months,
)

STMT = {
    "docType": "401k_statement", "capturedOn": "2026-10-05", "ownerMemberId": "a",
    "fields": {"employer_contribution_period": "1500", "statement_period_months": "3", "ending_balance": "50000"},
}


def test_statement_match_monthly_from_own_period():
    m = k401_statement_match_for([STMT], "a")
    assert m is not None
    assert m.period_total == 1500
    assert m.months == 3
    assert m.monthly == 500


def test_statement_period_from_range_string():
    fields = {"employer_contributions": "1500", "statement_period": "07/01/2026 - 09/30/2026"}
    assert statement_period_months(fields) == 3
    doc = {"docType": "401k_statement", "capturedOn": "2026-10-05", "ownerMemberId": "a", "fields": fields}
    assert k401_statement_match_for([doc], "a").monthly == 500


def test_statement_fallback_resolution():
    res = employer_match_for(statement=k401_statement_match_for([STMT], "a"))
    assert res.monthly == 500
    assert res.status == "from_statement"
    assert res.source_label == "From statement"


def test_payslip_wins_over_statement():
    res = employer_match_for(payslip_monthly=300, statement=k401_statement_match_for([STMT], "a"))
    assert res.monthly == 300
    assert res.status == "from_payslip"


def test_payslip_zero_line_is_a_real_figure():
    res = employer_match_for(payslip_monthly=0.0, statement=k401_statement_match_for([STMT], "a"))
    assert res.monthly == 0.0
    assert res.status == "from_payslip"


def test_unowned_statement_is_never_used():
    unowned = {"docType": "401k_statement", "capturedOn": "2026-10-05", "ownerMemberId": None,
               "fields": {"employer_contribution_period": "1500", "statement_period_months": "3"}}
    assert k401_statement_match_for([unowned], "a") is None


def test_another_members_statement_is_never_used():
    assert k401_statement_match_for([STMT], "b") is None


def test_detected_but_not_paced():
    doc = {"docType": "401k_statement", "capturedOn": "2026-10-05", "ownerMemberId": "a",
           "fields": {"employer_contributions": "1500"}}
    m = k401_statement_match_for([doc], "a")
    assert m is not None and m.monthly is None
    res = employer_match_for(statement=m)
    assert res.detected_not_paced is True
    assert res.status == "not_detected"
    assert res.monthly is None


def test_no_source_is_unknown_never_zero():
    res = employer_match_for()
    assert res.status == "unknown"
    assert res.source_label == "Unknown"
    # The model's semantics: an unknown carries NO figure - it is
    # None, and None is not 0: it cannot be summed as $0.
    assert res.monthly is None
    assert res.monthly != 0
    res_nd = employer_match_for(relevant_docs_exist=True)
    assert res_nd.status == "not_detected"
    assert res_nd.monthly is None


def test_user_confirmed_is_the_last_figure_source():
    res = employer_match_for(user_monthly=250)
    assert res.monthly == 250
    assert res.status == "user_confirmed"


def test_balance_statement_replaces_own_401k_rows():
    owned = [{"kind": "401k", "value": 40000}, {"kind": "ira", "value": 5000}]
    out = adult_starting_balance(owned, fallback=0, statement401k=52000)
    assert out.balance == 57000  # 45,000 - 40,000 (own 401k rows) + 52,000 (statement)
    assert out.statement_applied is True
    assert out.replaced_401k == 40000


def test_balance_without_statement_is_owned_or_fallback():
    owned = [{"kind": "401k", "value": 40000}]
    assert adult_starting_balance(owned, fallback=9000, statement401k=0).balance == 40000
    assert adult_starting_balance([], fallback=9000, statement401k=0).balance == 9000


def test_balance_statement_alone_and_fallback_wins():
    assert adult_starting_balance([], fallback=0, statement401k=52000).balance == 52000
    out = adult_starting_balance([], fallback=9000, statement401k=52000)
    assert out.balance == 9000
    assert out.statement_applied is False
