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
- RSU vesting (`equity.py`): ordinary income at vest, 22% supplemental
  withholding (37% above $1M), the projected gap inside the household
  projection, post-vest lot basis and holding start
- ESPP dispositions (`equity.py`): qualifying vs disqualifying
  classification (2-year grant / 1-year purchase day counts), ordinary
  income under each class, basis and capital result
- Foreign (`foreign.py`): FBAR aggregate test, Form 8938 thresholds by
  status and residence, foreign tax credit limitation (single basket)
- Intake (`intake.py`) and extraction (`extract.py`): household model +
  validation + derived accuracy level; source-agnostic field extraction
  with the 0.80 confidence gate
- Freshness (`freshness.py`), confidence (`confidence.py`): per-type
  freshness windows and the 0-100 prediction-confidence formula with the
  calibration anchor
- Guidance (`guidance.py`, SPEC45): sec. 16 profile-driven document
  requests, sec. 17 intelligent payroll shortcut, sec. 20 annual planning
  cycle, sec. 39+42 the one NEXT ACTION in the section 42 format

Not modelled yet (the engine says so rather than guessing):
- Treaties other than US-Israel (which IS modelled, `treaty.py` +
  treaty-us-il pack: withholding caps, saving clause, Social Security
  and pension positions); multi-basket FTC, FTC carryback/carryforward
  year modelling
- Credits (child tax credit, AOTC), AMT, itemized-deduction detail

## Data status
- `federal-2026.json` - version 2026.1-official, VERIFIED 2026-11-07
  against IRS Revenue Procedure 2025-32 (IR-2025-103). The prototype's
  estimated constants (2026.0-estimated) proved materially wrong - every
  bracket threshold and the standard deductions differed - and were
  replaced wholesale. Golden tests G1-G3 were recomputed on the official
  figures.
- `states-2026.json` - still ESTIMATED (ported prototype figures). The AZ
  2.5% flat rate is statutory since 2023; a DOR-publication verification
  pass over all states is still owed before production use.
