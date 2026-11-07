# HomeTower - Phase 1A Salvage Audit of the ~/hct Prototype

Date: 2026-11-07. Method: full backend file inventory (55 Python files) plus line-by-line
reads of every file that carries logic, on the owner's Mac. Mobile shell inventoried,
not read line-by-line (see verdict below).

## Headline
The prototype's value is a math heart, not a body. Real logic lives in about 8 files
(~35 KB). The rest is a standard FastAPI/Expo scaffold with stub domains. Port the
heart into a new, tested engine; discard the body.

## PORT - logic that carries over

1. **tax_engine/federal_calculator.py** - ordinary brackets, LTCG stacking, marginal
   rate, distance-to-next-bracket. Clean pure functions. Caveats: constants are
   hardcoded in code and self-marked "2026 estimated"; NIIT constants are defined
   but never applied at this level. Port the math; move every constant into a
   versioned content pack; verify figures against official IRS publications.
2. **investment_simulator/service.py** - the TaxImpact core: ST delta method, LT
   stacking, NIIT applied, capital-loss carryforward, sell-now-vs-wait comparison,
   GREEN/YELLOW/RED bracket alert. Bugs found: (a) the timing comparison calls
   `_niit(..., magi_value, ...)` - `magi_value` is undefined in this module, so any
   short-term-gain simulation crashes with NameError on the headline path;
   (b) a walrus condition assigns the comparison result, sloppy but functional.
   Port with both fixed and with tests.
3. **investment_simulator/wash_sale.py** - correct 61-day window logic. Limits,
   documented in code: exact-ticker match only, and full (not proportional)
   disallowance. Port with limits stated to the user.
4. **tax_engine/service.py** - household snapshot: federal + NIIT + state, refund/owe
   vs withholding YTD. This is the seed of the Phase 1 projection-vs-target. Caveat:
   state tax is Arizona flat on gross income - no AZ deduction or adjustments.
   Port as the projection skeleton; generalise the state side.
5. **tax_engine/state_calculator.py** - state tax ON A GAIN for all 50 states + DC
   (a TaxImpact helper, not a state projection engine). Flat-rate table includes
   AZ 2.5%; progressive states use a single effective rate at ~$250K and are
   flagged in code as approximations. Use the tables as seed data for state packs.
6. **services/textract_service.py** - OCR field maps for 7 document types (W-2,
   payslip, HSA statement, 401(k) statement, 1099-B, 1098-T, 1099-Q) plus
   confidence scoring. Port the field maps as data. The implementation (AWS S3 +
   Textract) conflicts with the vision's local-first privacy; the OCR engine
   choice is re-decided at build time.
7. **workers/ocr_tasks.py** - pipeline design: upload, extract, confidence gate
   0.80 (parsed vs pending-verify - the same confirm/correct pattern as the
   Phase 1 intake), then recompute the snapshot. Port the design. Implementation
   flaws: file bytes passed through the Celery broker; the recomputed snapshot
   is returned but never persisted.
8. **household/models.py** - household + members schema (state, filing status,
   DOB, role, W-2 income, withholdings YTD). Port as the intake data-model seed.
9. **tax_simulator/service.py** - what-if deltas (401k, HSA, Roth conversion).
   Bug: the `change_withholding` action is accepted but never applied. Port the
   pattern, fix the action.

## DISCARD
- The mobile app shell in full (template Expo app; per the 2026-10-16 review:
  mock dashboard data, API URL hardcoded to localhost, requests do not attach
  the auth token).
- tax_engine/arizona_calculator.py as a standalone file (5 lines; folds into
  state pack data).
- Stub domains as-is: brokerage, snapshots, alerts, retirement, education carry
  routers/services of 300-900 bytes - names and intent only, no logic to port.
- Every hardcoded "estimated" tax constant - replaced by versioned content
  packs, per the vision (content with a version, no code change).
- The prototype has NO tests anywhere. The new engine ships with tests from
  day one; ported math gets golden-case tests against worked IRS examples
  before any use.

## Recommendation
Build the new app as decided. Port the six logic assets above (items 1-7, 9)
into a fresh engine package with all tax data as versioned content packs and
golden-case tests; do not resurrect the old backend wholesale - its wiring
costs more to repair than to rebuild around the ported math. Phase 1 build
order is unchanged: intake, projection vs target (federal + AZ), monthly
snapshot, TaxImpact.
