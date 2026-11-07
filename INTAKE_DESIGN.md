# HomeTower - Phase 1D Findings: Document Intake + Household Intake Page

Date: 2026-11-07. Status: findings and recommendation, awaiting owner approval
before any build (per PROCESS.md).

## What Phase 1 requires
PHASE1.md wedge item 1: document intake + data extraction, document-first,
typing last. Plus the owner's Phase 1 requirements: one clear household
intake page, upload/read simplicity as a core requirement, and the flags
for RSU / ESPP / non-US items decided on 2026-11-07.

## Findings

1. **The portable part of the prototype's OCR is the normalization, not AWS.**
   The audit showed textract_service.py splits into (a) AWS block parsing,
   which is Textract-specific and cloud-bound, and (b) field-map matching,
   amount parsing and the confidence score, which are source-agnostic. The
   field maps already live in `engine/content/ocr-field-maps.json`. Any OCR
   source that yields key-value text pairs can feed (b).

2. **OCR engine choice is a privacy decision before it is a tech decision.**
   The vision is local-first, and the competitor-lessons research made trust
   the product: sending a family's W-2s and pay stubs to a cloud OCR by
   default contradicts both. On-device OCR (Apple Vision on iOS, ML Kit on
   Android) keeps documents on the phone, costs nothing per document, and
   its weaker form understanding is absorbed by the design we already have:
   the 0.80 confidence gate plus user confirm/correct on every field.

3. **The intake data model needs five additions over the prototype schema**
   (household/models.py): the refund target band (the Phase 1 centre),
   per-member pay frequency (projection annualisation), a documents
   register (type, status parsed/pending-verify, confidence), the
   RSU/ESPP/non-US flags, and an accuracy-level field computed from what
   has actually been provided - the level is derived, never self-declared.

4. **Extraction can be fully built and tested now, without the app shell.**
   A pure module - raw key-value pairs in, normalized fields + confidence +
   status out - is deterministic and golden-testable today. The capture
   side (camera, upload, on-device OCR) belongs to the app-shell phase and
   plugs into the same interface.

## Recommendation
Build Phase 1D as two engine modules now:
- `intake.py` - household intake model + validation + derived accuracy
  level (X with the minimum set; each document type unlocks more).
- `extract.py` - source-agnostic extraction: field maps + amount parsing +
  confidence gate (parsed at >= 0.80, else pending-verify), ported from the
  prototype's normalization logic, with golden tests on synthetic
  key-value inputs for all 7 document types.

Defer to the app-shell phase: camera/upload UI and the on-device OCR
adapter. No cloud OCR in Phase 1; the interface leaves the slot open and
the decision is revisited only with evidence from real documents.
