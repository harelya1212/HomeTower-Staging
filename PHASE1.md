# HomeTower - PHASE 1 SPEC

## Phase 1 wedge (the launch scope, frozen)
1. Document intake + data extraction: simple upload of any financial file; the profile fills from documents, the user confirms or corrects. Typing is last resort.
2. Tax projection: federal + ONE state, live across the year, measured against a user-set refund target band. Paystub-driven.
3. Monthly household snapshot ("מה מצבנו?"): one screen, one big number per topic, traffic-light status, top 3 actions only.
4. TaxImpact: one pre-sale simulation from ONE brokerage import format - sell now vs wait, ST/LT, capital-loss carryforward, wash sale, NIIT, state tax.

## Phase 1 enablers (also in scope)
- Household intake page: family data, dates, state, filing status, goals. Minimum fields for Accuracy Level X first; every added document unlocks more.
- Graphics: financial in look, simple in understanding. Refund gauge vs target, red/yellow/green per topic, one forecast line forward.
- Link infrastructure, built but INACTIVE commercially: config-driven links (content pack, no code change), click measurement, partner-disclosure slot. Phase 1 shows official links only (IRS, state tax authority, SSA).
- Measurement from day one: activation, intake completion, month-2 return.

## Accuracy levels (shown to the user, never hidden)
- X - Directional (+/-15-20%): broad balances and goals.
- X+ - Planning (+/-7-10%): latest payslips, elections, balances, 529.
- X++ - Decision grade (+/-3-5%): YTD payroll, known events, gain/loss export, carryforwards.
- X+++ - Filing grade (~1-2%): final official forms only. Missing material numbers are flagged, never estimated.

## Success gate for Phase 1 (defined before code)
Beta households that: complete intake, receive a projection against their target, and return in month 2 for the next snapshot. If that does not happen, the problem is the product, not the marketing.

## Equity and foreign scope (owner decision 2026-11-07, superseding the morning split)
ALL of the following enter Phase 1 IN FULL. Owner's reason, recorded: he
personally holds such items, and will use his own real cases to judge the
quality of the answers.
- Stocks: TaxImpact on purchased lots (already in the wedge).
- RSU: vesting events modelled - ordinary income at vest, the 22%
  supplemental-withholding gap projected against the household's actual
  projection, and post-vest sales as lots (basis = vest-date value,
  holding period from vest).
- ESPP: qualifying vs disqualifying disposition classification, discount
  as ordinary income under each class, basis and holding-period results.
- Foreign: non-US accounts and income module - FBAR (FinCEN 114) filing
  test, Form 8938 filing test, foreign tax credit limitation.
- The intake still ASKS about all of these from day one; nothing is
  flagged not-yet-modelled for these categories any more. What remains
  outside Phase 1 in this area: treaties OTHER than US-Israel and
  multi-year equity scenario depth (the deferred Scenario Engines).
- Treaties (owner decision 2026-11-07, later the same day): the US-Israel
  treaty enters Phase 1 IN FULL - withholding caps (dividends 25% /
  12.5% direct, interest 17.5% / 10% financial institutions / 0%
  government-backed, royalties 10% copyright / 15% industrial), the
  Article 6(3) saving clause and what survives it, Social Security and
  pension taxing rights, relief via the foreign tax credit. Data lives in
  the versioned treaty-us-il content pack, cross-checked against the IRS
  treaty table. Other countries' treaties stay deferred.

## DEFERRED - re-examine at phase gates, do not delete
- Full Retirement Scenario Engine (per-spouse, 10/12/15 years)
- Full Stock / Equity Scenario Engine
- Full Education Engine per child (incl. AOTC, 1098-T / 1099-Q coordination)
- Major Purchase Engine
- Full 401(k) / Mega Backdoor / HSA limit tracking and payroll forecasting
- Full capital / passive / QBI loss rules
- All-50-states tax packs
- Monetised partner links (activate in Phase 2, gated on proven retention, proven projection accuracy against filed returns, and disclosure in place; first vertical: filing services at the end of the projection cycle)
- The two weak model assumptions under re-examination: ads-only revenue, viral growth

## Living data, document freshness, push (owner requirements, 2026-11-07)
- LIVING DATA: after the household defines what it has and its goals,
  everything stays editable - update, add, remove - at any time, and
  every change recomputes the snapshot and the accuracy level. Intake is
  not a one-time wizard; it is the household's living record.
- DOCUMENT FRESHNESS: every document type has a freshness window
  (engine freshness module). Stale or about-to-expire documents are
  flagged in the app, and the user gets a PUSH about old documents and
  documents that need updating.
- PUSH DEFAULTS ON. Push is built with the TReps lessons applied from
  day one, not relearned: static imports only for the push module (a
  dynamic import behind a silent catch is what faked "unsupported" in
  TReps); "enabled" is claimed ONLY from a stored push token, never from
  permission state or a button label; failures surface as visible stage
  diagnostics in the UI, never silently; the token record and the sender
  use the same identity key (TReps event push failed on exactly that
  mismatch).
