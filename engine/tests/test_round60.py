"""Round 60 (Copilot root-cause repair) - Python-side pins for the
pieces that live in both engines: the Arizona model honesty
descriptor (P1-A) and the statement period label (P2). The P0-A
statement-precedence goldens live in test_retirement.py beside
the function they pin."""
from hometower_engine.retirement import k401_statement_match_for, statement_period_label
from hometower_engine.state import compute_arizona_tax, state_tax_model_info


def test_arizona_model_info_is_honest():
    info = state_tax_model_info("AZ")
    assert info["model_kind"] == "flat_rate_approximation"
    assert info["full_return_modeled"] is False
    assert info["label_parts"] == [
        "Arizona projection", "Planning estimate", "Flat-rate approximation",
        "Full Arizona return adjustments not yet modeled",
    ]
    assert info["label"] == " - ".join(info["label_parts"])


def test_arizona_math_unchanged_by_the_label():
    # P1-A is honesty, not a new tax model: AGI x 2.5% flat.
    assert compute_arizona_tax(200000) == 5000.0
    assert compute_arizona_tax(-100) == 0.0


def test_statement_period_label():
    fields = {"statement_period_start": "2026-01-01", "statement_period_end": "2026-11-06"}
    assert statement_period_label(fields) == "Jan-Nov 2026"
    assert statement_period_label({"statement_period": "07/01/2026 - 09/30/2026"}) == "Jul-Sep 2026"
    assert statement_period_label({}) is None
    assert statement_period_label(None) is None


def test_statement_match_carries_period_label():
    docs = [{
        "docType": "401k_statement", "ownerMemberId": "m1", "capturedOn": "2026-11-09",
        "fields": {
            "employer_contribution_period": "11466.08",
            "statement_period_start": "2026-01-01", "statement_period_end": "2026-11-06",
        },
    }]
    m = k401_statement_match_for(docs, "m1")
    assert m is not None
    assert m.period_total == 11466.08
    assert m.months == 10
    assert m.period_label == "Jan-Nov 2026"
