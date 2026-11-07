# HomeTower Engine

The tax math core of HomeTower, ported from the ~/hct prototype per
`../SALVAGE_AUDIT.md`. All tax constants live in versioned content packs
under `content/` - the code is math only, and a tax-year update is a new
pack file, never a code change (per VISION).

## Layout
- `hometower_engine/federal.py` - ordinary brackets, LTCG stacking, NIIT,
  marginal rate, distance to next bracket
- `hometower_engine/state.py` - state tax on a gain (TaxImpact helper) +
  Arizona flat tax
- `hometower_engine/wash_sale.py` - 61-day wash-sale window
- `hometower_engine/taximpact.py` - pre-sale simulation: ST vs LT, NIIT,
  loss carryforward, sell-now-vs-wait, GREEN/YELLOW/RED
- `hometower_engine/snapshot.py` - household snapshot (refund/owe vs
  withholding) + what-if scenarios (401k, HSA, Roth conversion, withholding)
- `content/federal-2026.json`, `content/states-2026.json` - tax data packs
- `content/ocr-field-maps.json` - document field maps for the intake OCR
- `tests/test_golden.py` - golden tests; expected values computed
  independently of the engine code

Run tests from the repo root: `python3 -m pytest engine/tests -q`
(10 tests, including regression tests for the two prototype bugs the audit
found: the ST-simulation NameError crash and the ignored withholding action).

## Modelled today, and NOT modelled - stated plainly
Modelled:
- Purchased brokerage lots: ST/LT, stacking, NIIT, state tax on the gain,
  capital-loss carryforward, wash sale (exact ticker, full disallowance)
- Federal projection vs withholding (MFJ / single / HoH / MFS), AZ state

Not modelled yet (the engine says so rather than guessing):
- RSU vesting events (ordinary income at vest, 22% supplemental withholding
  gap) - a post-vest RSU sale IS modelled as a normal lot whose basis is
  the vest-date value and whose holding period starts at vest
- ESPP dispositions (qualifying vs disqualifying, discount as ordinary
  income) - the sale of ESPP shares after a disqualifying disposition is
  modelled as a normal lot; the disposition classification itself is not
- Foreign-source income and foreign accounts (FBAR, Form 8938, foreign
  tax credit, treaties) - not modelled at all in this phase
- Credits (child tax credit, AOTC), AMT, itemized-deduction detail

## Data status
Both 2026 packs are marked ESTIMATED in their own files: the figures were
ported from the prototype's constants. Before any production use they must
be verified against official IRS / state DOR publications and the pack
version bumped.
