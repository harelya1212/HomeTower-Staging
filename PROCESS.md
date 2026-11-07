# HomeTower - PROCESS RULES (binding)

Set by the product owner on 2026-11-06, before the go decision. These rules outrank convenience.

## 1. Token optimization / lessons from TReps
- Prevent defects at creation with generation rules; do not fix predictable defects after the fact.
- Mechanical checks and fixes run as deterministic scripts at zero tokens (structure, duplicates, wiring, exact text swaps).
- Agents do semantic work only, in parallel, in complete batches - never in small drips.
- Complete files in one go. Never piecemeal, never partial, no placeholder files.
- One batched push per round, on a single approval card.
- Status is reported at phase close only. No hourly status reports.

## 2. Staging / live logic (GitHub)
- Two environments: STAGING (this repo) and LIVE (separate repo, created later).
- Live is frozen. Promotion to live happens only on the owner's explicit order, batched, never per change.
- Staging is a 1:1 mirror of live plus unreleased development, and doubles as backup.

## 3. One asset library
- All images and brand assets live in `assets/` only, registered in `assets/ASSETS.md`.
- Wiring from the registry is done by script, never by hand.
- An asset that is not in the registry does not exist.

## 4. QA gates
- QA is the closing gate of every phase, not an afterthought ("בסוף כל שלב ולא בדיעבד").
- A phase is not done until QA passes, verified on a real device and in the served bytes - not in repo files.
- QA defects are fixed immediately, without asking whether to fix them, including hint and image defects.

## 5. Decision flow
- Findings and a recommendation first. Owner approval before building. Owner approval again before any push to live.
- Nothing is deleted from the vision; out-of-scope items move to the DEFERRED list in `PHASE1.md` and are re-examined at phase gates, based on usage data.
