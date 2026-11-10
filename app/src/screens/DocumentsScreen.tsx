import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { predictionConfidence } from "../../engine/confidence.ts";
import { extractFields, type ExtractionResult } from "../../engine/extract.ts";
import { documentFreshness, FRESHNESS_WINDOW_DAYS, householdFreshness } from "../../engine/freshness.ts";
import { DateField, TextField, isoToUs } from "../components/Fields.tsx";
import type { EquityEvent } from "../store.tsx";
import { DOCUMENT_TYPES, type DocumentRecord } from "../../engine/intake.ts";
import { documentRequests, payrollShortcut } from "../../engine/guidance.ts";
import { classifyDocument, type Classification } from "../../engine/classify.ts";
import { pickImageUri, pickImageUris, probeImageSize, recognizeImageBands, recognizeImageFile, recognizeImageUpscaled, recognizeOnDevice, takePhotoUri, textToRawFields } from "../ocr.ts";
import type { RawField } from "../../engine/extract.ts";
import { parseHoldings, parsePlanAccount, positionValue, type HoldingsParse, type PlanAccount } from "../holdings.ts";
import { parseSpendingCsv, type CsvSpending } from "../spendingCsv.ts";
import { parsePayslipRows } from "../payslipRows.ts";
import { docEvidenceStatus, employerMatchFor, k401StatementFacts, k401StatementMatchFor, monthYearLabel, statementMatchLine } from "../goals.ts";
import { hsaAccuracy } from "../domainAccuracy.ts";
import { mergePayslipFields, payslip401kTotals, payslipDeductionTotals, payslipKey } from "../payslips.ts";
import {
  extractSectionReading, hsaDepositFields, hsaPageDetectedFields, k401DetailFields, parse401kDetail, parseSaForm,
  portfolioTotalOf, segmentStatement, statementPeriodOf,
  type K401Detail, type SaFormParse, type StatementPeriod, type StatementSection,
} from "../statementSections.ts";
import { invariantViolations, runInvariants } from "../invariants.ts";
import { kpiLineage, lineageCoverage } from "../kpiLineage.ts";
import { boundRawText, dateLabel, eduMonthlyTotal, eduReconYearsFor, eduResolutionFor, eduVerifiedKey, EXTRACTOR_VERSION, fingerprintForSave, hsaBalanceSnapshots, hsaContributionReconciliation, hsaReconciliation, hsaResolution, monthNameOf, monthYearOf, sourceLabelFor, upsertDocument, validateCanonicalEvidence } from "../reconcile.ts";
import { ocrMapsPack } from "../../engine/packs.ts";
import { pickFiles, pickImageFiles } from "../filePick";
import { isEmptyRead, unmatchedExcerpt } from "../textFields.ts";
import { extractPdfText, extractPdfTextFromBuffer } from "../pdfText";
import { buildProfileExtras, todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

// Round 57: the fanned HSA reading shows its figures under
// labelled lines, never bare keys. The period figure is a MONTHLY
// total and is labelled with the month it covers; the per-payroll
// figure is its own line when the statement's deposit detail
// proved one; the deposit detail itself renders as dates and
// amounts, never as raw JSON. Keys this round does not know keep
// the generic key line, as before.
function hsaFanLines(fields: Record<string, number | string>, period: StatementPeriod | null): { key: string; text: string }[] {
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (k: string): number | null => {
    if (fields[k] === undefined) return null;
    const v = Number(fields[k]);
    return Number.isFinite(v) ? v : null;
  };
  const lines: { key: string; text: string }[] = [];
  const handled = new Set<string>();
  const add = (key: string, text: string | null) => { if (text !== null) { lines.push({ key, text }); handled.add(key); } };
  const bal = num("ending_balance");
  add("ending_balance", bal !== null ? `Ending balance: ${money(bal)}` : null);
  const per = num("contributions_period");
  add("contributions_period", per !== null ? `${period ? monthYearOf(period.endIso) : "Statement period"} contributions: ${money(per)}` : null);
  const pp = num("per_payroll_contribution");
  add("per_payroll_contribution", pp !== null ? `Per-payroll contribution: ${money(pp)} (from the statement's deposit detail)` : null);
  const ytd = num("contributions_ytd");
  add("contributions_ytd", ytd !== null ? `Contributions year to date: ${money(ytd)}` : null);
  const dist = num("distributions_ytd");
  add("distributions_ytd", dist !== null ? `Distributions year to date: ${money(dist)}` : null);
  if (typeof fields["deposit_detail"] === "string") {
    handled.add("deposit_detail");
    try {
      const deps = JSON.parse(fields["deposit_detail"]) as { date: string; amount: number }[];
      if (Array.isArray(deps) && deps.length) {
        const short = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${monthNameOf(d).slice(0, 3)} ${Number(d.slice(8, 10))}` : d);
        lines.push({ key: "deposit_detail", text: `Deposit detail: ${deps.map((d) => `${short(d.date)} - ${money(Number(d.amount))}`).join(" · ")}` });
      }
    } catch { /* an unparseable detail string is never rendered as raw JSON */ }
  }
  for (const [k, v] of Object.entries(fields)) {
    if (!handled.has(k)) lines.push({ key: k, text: `${k}: ${String(v)}` });
  }
  return lines;
}

const BADGE: Record<string, string> = { fresh: "#1E8E3E", aging: "#E37400", stale: "#C5221F", unknown: "#5A6B7C" };

// Split-image OCR repeats the overlap band's lines; the row parser
// consumes them by index, so the duplicate copy used to leak into
// generic pairing and invent current-period figures from YTD-only
// rows (device finding, round 35: Yamit's YTD 401k appeared as her
// current contribution). Drop every line whose normalized text the
// row parser already consumed, not just the consumed indices.
// Round 56: an image is routed to OCR by MIME type OR by file
// extension - an image whose picker delivered an empty/generic
// MIME type (iOS Files does this for some sources) must never fall
// through to the "not a PDF or a photo" refusal, and must never
// reach the PDF branch (which would fail on its bytes anyway).
function isImageFile(f: File): boolean {
  return f.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(f.name);
}

function dropConsumedLines(text: string, consumedIdx: number[]): string {
  const lines = text.split(/\r?\n/);
  const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  const idx = new Set(consumedIdx);
  const texts = new Set(consumedIdx.map((i) => norm(lines[i] ?? "")).filter((x) => x.length >= 4));
  return lines.filter((l, i) => !idx.has(i) && !texts.has(norm(l))).join("\n");
}

export default function DocumentsScreen() {
  const { state, update, updateIntake } = useHousehold();
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const confirmY = useRef(0);
  const failureY = useRef(0);
  // Within one multi-photo batch: the payslip saved from the previous
  // screenshot (identity key + its index in intake.documents), so the
  // next page of the SAME slip merges into it instead of duplicating.
  const batchSaveRef = useRef<{ key: string; index: number } | null>(null);
  const docs = state.intake.documents;
  const today = todayIso();
  const findings = useMemo(() => householdFreshness(docs, today), [docs, today]);
  const byKey = useMemo(
    () => new Map(docs.map((d, i) => [i, findings.find((f) => f.docType === d.docType)])),
    [docs, findings],
  );
  const indicators = useMemo(() => predictionConfidence(state.intake, today).perDocument, [state.intake, today]);
  const countsLabel = (c: string) => (c === "fully" ? "● counts fully" : c === "partially" ? "◐ counts partially" : "○ counts barely");
  const countsColor = (c: string) => (c === "fully" ? "#1E8E3E" : c === "partially" ? "#E37400" : "#C5221F");
  const [selectedType, setSelectedType] = useState("payslip");
  const [showManual, setShowManual] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  // Round 60 (P0-B): a canonical-validation block on the pending
  // save - the reasons the reading was NOT saved, shown on the
  // confirm card itself.
  const [saveBlock, setSaveBlock] = useState<string[] | null>(null);
  const [flowNote, setFlowNote] = useState<string | null>(null);
  // 529 assignment (owner QA round 19): a statement can fill a specific
  // child's college funding - picked from the My House child card (via
  // the store intent) or in the confirm card below.
  const [assignChildId, setAssignChildId] = useState<string | null>(null);
  const eduChildren = state.family.filter((m) => m.role === "child");
  // Round 49: a Social Security statement names ONE adult - the
  // confirm card asks whose it is, and the choice is stored on the
  // document so its estimated benefit feeds that adult's dependable
  // income (Home + Retirement Lifestyle).
  const [assignMemberId, setAssignMemberId] = useState<string | null>(null);
  const [assign401kMemberId, setAssign401kMemberId] = useState<string | null>(null);
  const adults = state.family.filter((m) => m.role === "self" || m.role === "spouse");
  useEffect(() => {
    if (state.eduAssignChildId) {
      setAssignChildId(state.eduAssignChildId);
      setSelectedType("529_statement");
      update({ eduAssignChildId: null });
    }
  }, [state.eduAssignChildId]);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [extractionType, setExtractionType] = useState("payslip");
  // Round 55 fan-out: one upload, several account readings. The
  // confirm card lists every detected account with its facts and
  // its assignment (child / adult), correctable before save.
  interface FanSectionState {
    section: StatementSection;
    fields: Record<string, number | string>;
    status: string;
    confidence: number;
    childId: string | null;
    memberId: string | null;
  }
  const [fanOut, setFanOut] = useState<{ sections: FanSectionState[]; period: StatementPeriod | null; portfolioTotal: number | null } | null>(null);
  const [pending401kDetail, setPending401kDetail] = useState<K401Detail | null>(null);
  const [pendingSaForm, setPendingSaForm] = useState<SaFormParse | null>(null);
  const [receiptInputs, setReceiptInputs] = useState<Record<string, string>>({});
  // Round 58: the 529 mirror of receiptInputs - verified education
  // expenses per child per tax year, keyed "childId:year".
  const [eduInputs, setEduInputs] = useState<Record<string, string>>({});
  const firstNameOf = (s: string) => (s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const matchChildByName = (printed: string | null): string | null => {
    if (!printed) return null;
    const fn = firstNameOf(printed);
    return eduChildren.find((c) => firstNameOf(c.name ?? "") === fn && fn !== "")?.id ?? null;
  };
  const matchAdultByName = (printed: string | null): string | null => {
    if (!printed) return null;
    const p = printed.trim().toLowerCase().replace(/\s+/g, " ");
    return adults.find((m) => {
      const n = (m.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      return n !== "" && (n === p || firstNameOf(n) === firstNameOf(p));
    })?.id ?? null;
  };
  const [detection, setDetection] = useState<Classification | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [pendingColumns, setPendingColumns] = useState<RawField[][] | null>(null);
  const [pendingHoldings, setPendingHoldings] = useState<HoldingsParse | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanAccount | null>(null);
  // Round 48: a statement CSV's parsed spending - carried to the
  // confirm card like the holdings parse, and stored on the saved
  // document as its spendingSummary (evidence for the Retirement
  // Lifestyle page).
  const [pendingSpending, setPendingSpending] = useState<CsvSpending | null>(null);
  // Multi-item intake queue (owner QA round 25 for photos; round 56
  // generalizes it to FILES): the user picks several items at once;
  // each is still read and confirmed one at a time, the queue just
  // walks itself after every confirm/discard. One item produces at
  // most one confirm card - a combined statement that fans out to
  // several account readings is ONE item with ONE card.
  type IntakeItem = { file: File } | { uri: string; name: string };
  const [intakeBatch, setIntakeBatch] = useState<{ queue: IntakeItem[]; namedType?: string; total: number; done: number; noun: "File" | "Screenshot" } | null>(null);
  // Round 56 (defect 3): a hard read failure is a CARD, not a small
  // note - it names what failed and why, in plain words.
  const [intakeFailure, setIntakeFailure] = useState<{ heading: string; body: string } | null>(null);
  const [autoPaste, setAutoPaste] = useState("");
  const [expandedReq, setExpandedReq] = useState<string | null>(null);
  const requests = useMemo(
    () => documentRequests(state.intake, buildProfileExtras(state), today),
    [state.intake, state.assets, state.family, today],
  );
  const reqBadge = (s: string) =>
    s === "satisfied" ? { t: "✓ Have it", c: "#1E8E3E" } : s === "stale" ? { t: "Stale - update", c: "#C5221F" } : { t: "Missing", c: "#E37400" };
  const hasPayslip = docs.some((d) => d.docType === "payslip" && d.status === "parsed");
  const [payAnswers, setPayAnswers] = useState({ gross: "no", net: "no", benefits: "no" });
  const [payNote, setPayNote] = useState<string | null>(null);
  // Ongoing center (owner-approved sketch, 2026-11-07)
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [showShortcut, setShowShortcut] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [evKind, setEvKind] = useState<EquityEvent["kind"]>("bonus");
  const [evDate, setEvDate] = useState(today);
  const [evAmount, setEvAmount] = useState("");
  const [evNote, setEvNote] = useState("");

  const confirmPayrollCycle = () => {
    const r = payrollShortcut(payAnswers.gross, payAnswers.net, payAnswers.benefits, state.payrollCheck.consecutive);
    if (r.provisional) update({ payrollCheck: { lastConfirmedOn: today, consecutive: r.consecutiveAfter } });
    setPayNote(r.reason);
  };

  // One pipeline for every capture path (owner requirement, 2026-11-07):
  // the app ALWAYS classifies what it read. With a named type it verifies
  // the name against the content; without one, the detected type is used.
  // Either way the user sees the reading and confirms before saving.
  // Pure extraction on one text (no state): the same construction
  // runExtraction uses, exposed so the section re-read can extract
  // per band and merge.
  const extractOnly = (text: string, docType: string) => {
    let raw = textToRawFields(text);
    if (docType === "payslip") {
      const slip = parsePayslipRows(text);
      if (slip.fields.length > 0) {
        const restText = dropConsumedLines(text, slip.consumedLines);
        raw = [...slip.fields, ...textToRawFields(restText)];
      }
    }
    return extractFields(raw, docType);
  };

  // Round 48: statement CSVs bypass the label-value pipeline - the
  // reading IS the spending summary. The confirm card shows the
  // months, the transaction count and the annualized outflows per
  // category, and the user confirms before anything is saved, under
  // the type they picked (or the kind the filename suggests).
  // Returns false when the text is not a readable statement CSV, so
  // callers fall back to the normal pipeline.
  const startCsvReading = (text: string, fileName: string, namedType?: string): boolean => {
    const kind: "bank" | "card" = namedType === "card_statement" || /card|credit/i.test(fileName) ? "card" : "bank";
    const summary = parseSpendingCsv(text, kind);
    if (!summary) return false;
    const useType = namedType === "bank_statement" || namedType === "card_statement"
      ? namedType
      : kind === "card" ? "card_statement" : "bank_statement";
    const fields: Record<string, number | string> = {
      months_covered: summary.months,
      transactions_counted: summary.transactions,
      outflow_per_year: Math.round(summary.totalOutflowAnnual),
    };
    for (const [k, v] of Object.entries(summary.byCategory)) fields[`spending_${k}`] = Math.round(v);
    setPendingSpending(summary);
    setPendingText(text);
    setPendingColumns(null);
    setPendingHoldings(null);
    setPendingPlan(null);
    setFanOut(null);
    setPending401kDetail(null);
    setPendingSaForm(null);
    setDetection(null);
    setExtraction({ documentType: useType, fields, fieldConfidence: {}, confidence: 1, status: "parsed" });
    setExtractionType(useType);
    setOcrNote(null);
    return true;
  };

  const runExtraction = (text: string, namedType?: string, pages?: string[], columnByPage?: RawField[][], opts?: { openUnmatchedCard?: boolean }) => {
    try {
      setSaveBlock(null);
      const textRaw = textToRawFields(text);
      if (!textRaw.length && isEmptyRead(text)) {
        // Round 56 (device QA defect 3): an empty read is an
        // extraction failure, not a classification outcome. The
        // confirm card still opens - in its empty-read form, which
        // leads with what happened (the card checks isEmptyRead
        // again at render time) and only then offers the register
        // save. Before this, the same state presented as "could not
        // identify - Confidence: 0 - save as other", which reads as
        // a classification choice and hides the failure.
        const empty = extractFields([], "other");
        setDetection(classifyDocument([], text));
        setPendingText(text);
        setPendingColumns(null);
        setPendingHoldings(null);
        setPendingPlan(null);
        setFanOut(null);
        setPending401kDetail(null);
        setPendingSaForm(null);
        setPendingSpending(null);
        setExtraction(empty);
        setExtractionType("other");
        setOcrNote(null);
        return { result: empty, docType: "other" };
      }
      if (!textRaw.length) {
        if (opts?.openUnmatchedCard) {
          // ROUND 59 (TRACE A): text WAS read (the read is not
          // empty - the branch above owns that case) but not one
          // label-value pair could be formed: a recognition-quality
          // outcome, and the confirm card must open in its honest
          // unmatched form (it shows what was read) instead of the
          // upload ending on a transient note with no card at all.
          const empty = extractFields([], "other");
          setDetection(classifyDocument([], text));
          setPendingText(text);
          setPendingColumns(null);
          setPendingHoldings(null);
          setPendingPlan(null);
          setFanOut(null);
          setPending401kDetail(null);
          setPendingSaForm(null);
          setPendingSpending(null);
          setExtraction(empty);
          setExtractionType("other");
          setOcrNote(null);
          return { result: empty, docType: "other" };
        }
        setOcrNote("No label-value pairs found in that text. Check the text and try again.");
        setExtraction(null);
        return null;
      }
      // Round 55 fan-out (workstream A): a statement carrying
      // several account sections becomes one reading PER ACCOUNT.
      // A portfolio total printed on the document is never stored
      // as an account's balance - only a section's own figures are.
      const sections = segmentStatement(text);
      if (sections.length >= 1) {
        const period = statementPeriodOf(text);
        setPendingText(text);
        setFanOut({
          sections: sections.map((s) => {
            const reading = extractSectionReading(s, period);
            return {
              section: s,
              fields: { ...reading.fields, ...hsaDepositFields(s) },
              status: reading.status,
              confidence: reading.confidence,
              childId: s.kind === "529" ? matchChildByName(s.personName) : null,
              memberId: s.kind === "hsa" ? matchAdultByName(s.personName) : null,
            };
          }),
          period,
          portfolioTotal: portfolioTotalOf(text),
        });
        setExtraction(null);
        setPending401kDetail(null);
        setPendingSaForm(null);
        setOcrNote(`Found ${sections.length} account${sections.length === 1 ? "" : "s"} in this document - check each one below, then confirm.`);
        return null;
      }
      // Round 55 (workstream E): an HSA tax form is identified by
      // its own title - the form decides its type, and its numbered
      // boxes join the extraction input.
      const form = parseSaForm(text);
      setPendingSaForm(form);
      const detected = classifyDocument([...textRaw, ...(form?.fields ?? [])], text);
      let useType = form ? form.kind : (namedType ?? detected.docType);
      setDetection(detected);
      setPendingText(text);
      setPendingColumns(columnByPage ?? null);
      const hp = parseHoldings(text);
      setPendingHoldings(hp.positions.length > 0 ? hp : null);
      setPendingPlan(parsePlanAccount(text));
      // Column-aware pairs (form PDFs) ride along AFTER the text pairs
      // in the general read - they fill what line pairing missed and
      // never override a figure the text already paired.
      const colFlat = columnByPage ? columnByPage.flat() : [];
      let raw = [...textRaw, ...colFlat];
      // Payslips: the structure-aware row parser leads (Workday-style
      // Amount|YTD tables defeat generic line pairing - measured
      // baseline: strong classification, ZERO fields). Lines the row
      // parser consumed are removed before generic pairing so a
      // YTD-only row cannot invent a current-period figure.
      if (useType === "payslip") {
        const slip = parsePayslipRows(text);
        if (slip.fields.length > 0) {
          const restText = dropConsumedLines(text, slip.consumedLines);
          raw = [...slip.fields, ...textToRawFields(restText), ...colFlat];
        }
      }
      // The SA form's box fields LEAD its read: the numbered boxes
      // are the canonical labels for these forms.
      if (form) raw = [...form.fields, ...raw];
      let result = extractFields(raw, useType);
      // Prior-return scoping (real-file rehearsal, 2026-11-07): a full
      // client copy runs 100+ pages of schedules whose repeated labels
      // pollute whole-document extraction. The return's own figures
      // live on the Form 1040 pages - when the PDF gave us pages,
      // extract from those two pages and prefer them when they yield
      // at least two figures.
      if (useType === "prior_return" && pages && pages.length > 2) {
        const idx = pages.findIndex((p) => /u\.s\. individual income tax return/i.test(p));
        if (idx >= 0) {
          // On the 1040 pages the column pairs LEAD: the form prints
          // its values in a right-hand column detached from the label
          // rows, so geometry is the only reliable pairing there
          // (column-aware round, 2026-11-07 - all five headline
          // figures exact on a real client copy).
          const scopedRaw = [
            ...(columnByPage?.[idx] ?? []),
            ...(columnByPage?.[idx + 1] ?? []),
            ...textToRawFields(pages.slice(idx, idx + 2).join("\n")),
          ];
          const scoped = extractFields(scopedRaw, "prior_return");
          // Prefer the scoped read only when its anchors beat the
          // whole-document read: schedule noise can fake figures, so
          // count positive AGI / total tax / owed-or-refund on each.
          const anchors = (f: Record<string, number | string>) =>
            (typeof f.adjusted_gross_income === "number" && f.adjusted_gross_income > 0 ? 1 : 0) +
            (typeof f.total_tax === "number" && f.total_tax > 0 ? 1 : 0) +
            ((typeof f.amount_owed === "number" && f.amount_owed > 0) || (typeof f.refund === "number" && f.refund > 0) ? 1 : 0);
          if (anchors(scoped.fields) > anchors(result.fields)) result = scoped;
        }
      }
      // Round 55 (workstream B): a photographed HSA page whose
      // balance the generic pairing missed gets the proximity read
      // - the Balance heading's own figure, fill-only, so a figure
      // the pairing DID find is never overridden.
      // ROUND 59 (TRACE A): the page signature is no longer gated
      // on the type being known first. On device, a Fidelity HSA
      // balances-page screenshot classified "other" with zero
      // fields in three straight sessions while this exact read
      // resolved its balance every time it was allowed to run -
      // the gate made the rescue unreachable from the automatic
      // path (the rehearsals passed only because they forced the
      // type). Now: when no balance was found and the text carries
      // the page signature, the page read runs; when the upload
      // was automatic and the classifier missed the document
      // entirely, the signature identifies it and the reading
      // saves as an HSA statement.
      const pageFields = hsaPageDetectedFields(text);
      if (pageFields && useType === "hsa_statement") {
        const extra = extractFields(pageFields, "hsa_statement");
        const mergedFields = { ...result.fields };
        for (const [k, v] of Object.entries(extra.fields)) {
          // ROUND 62 (R62-1a): for the ending balance the page
          // read WINS over the generic pairing - the page reader
          // is block-aware (it reads the HSA's own block, never a
          // sidebar account's), while the generic label pairing
          // can pair a "balance" label in the sidebar with the
          // 401(k)'s figure. Every other field still fills only.
          if (k === "ending_balance" || mergedFields[k] === undefined) mergedFields[k] = v;
        }
        result = { ...result, fields: mergedFields };
      } else if (pageFields && namedType == null && !form && detected.docType === "other") {
        const extra = extractFields(pageFields, "hsa_statement");
        if (typeof extra.fields["ending_balance"] === "number") {
          const mergedFields = { ...extra.fields };
          for (const [k, v] of Object.entries(result.fields)) {
            if (mergedFields[k] === undefined) mergedFields[k] = v;
          }
          result = { ...extra, fields: mergedFields };
          useType = "hsa_statement";
          setDetection({
            docType: "hsa_statement", level: "likely", score: detected.score,
            signals: ["HSA account page - balance read by proximity"], runnerUp: null, runnerUpScore: 0,
          });
        }
      }
      // Round 55 (workstream F): the 401(k) detail facts ride along
      // with the confirm card and are saved with the record.
      setPending401kDetail(useType === "401k_statement" ? parse401kDetail(text) : null);
      setExtraction(result);
      setExtractionType(useType);
      setOcrNote(null);
      return { result, docType: useType };
    } catch (e) {
      setOcrNote(e instanceof Error ? e.message : String(e));
      setExtraction(null);
      return null;
    }
  };

  // Image reads get a self-healing second pass (owner demand,
  // 2026-11-08: fix the app so it reads the files correctly - and
  // rigorously for EVERY employer's format, not one company's).
  // The band re-read is layout-agnostic: small, enlarged sections
  // for any tall screenshot. It triggers when the fast pass loses a
  // payslip's headline YTD figures - the tables the phone engine
  // kept dropping - or when any document reads implausibly thin.
  // Band extractions fill ONLY fields still missing, so a band can
  // rescue a reading but never override it, and the user still
  // confirms the full reading before anything is saved.
  const runImageExtraction = async (text: string, namedType: string | undefined, file: File, batchLabel?: string) => {
    let r = runExtraction(text, namedType, undefined, undefined, { openUnmatchedCard: true });
    if (!r) return;
    // ROUND 59 (TRACE A): the wide-image retry ladder. The first
    // pass read text but matched NOTHING (type "other", zero
    // fields) - the exact signature of the HSA screenshot that
    // failed on device three times. The band re-read below
    // structurally refuses wide images, so a wide screenshot had
    // no second pass at all. One enlarged re-read (rendered at
    // roughly 2600 px wide, never below native) runs instead; it
    // is accepted only when it resolves, and it is RESCUE-ONLY -
    // it never overrides a first-pass read that matched. When it
    // also fails to resolve, the honest unmatched card stands,
    // showing the longer of the two texts as its excerpt.
    if (r.docType === "other" && Object.keys(r.result.fields).length === 0) {
      const size = await probeImageSize(file);
      if (size && size.h < size.w * 1.2) {
        const label = batchLabel ? `${batchLabel} - ` : "";
        setOcrNote(`${label}the first read did not match a known document - re-reading the photo enlarged...`);
        const up = await recognizeImageUpscaled(file, (pct) => setOcrNote(`${label}re-reading enlarged - ${pct}%`));
        if (up && !up.error && up.text) {
          const r2 = runExtraction(up.text, namedType, undefined, undefined, { openUnmatchedCard: true });
          if (r2 && (r2.docType !== "other" || Object.keys(r2.result.fields).length > 0)) {
            r = r2;
            setOcrNote(`${label}the enlarged re-read worked - please check the full reading below.`);
          } else if (up.text.length <= text.length) {
            // The enlarged text is no better: restore the first
            // read so the unmatched card shows the richer text.
            runExtraction(text, namedType, undefined, undefined, { openUnmatchedCard: true });
            setOcrNote(null);
            return;
          } else {
            setOcrNote(null);
            return;
          }
        } else {
          setOcrNote(null);
          return;
        }
      }
    }
    const f = r.result.fields;
    const payslipHole = r.docType === "payslip" &&
      (typeof f.ytd_federal_withheld !== "number" || typeof f.ytd_taxable_wages !== "number");
    const thinRead = Object.keys(f).length < 3;
    if (!payslipHole && !thinRead) return;
    const label = batchLabel ? `${batchLabel} - ` : "";
    setOcrNote(`${label}the first read missed part of this document - re-reading the photo in sections...`);
    const bands = await recognizeImageBands(file, (pct) => setOcrNote(`${label}re-reading in sections - ${pct}%`));
    if (bands.error || !bands.texts.length) { setOcrNote(null); return; }
    if (isEmptyRead(text) && r.docType === "other") {
      // Round 56: the first pass found NOTHING (the empty-read
      // card is on screen). A band may still hold the document -
      // the tall-screenshot failure mode is exactly a first pass
      // that drops everything. Re-run the full pipeline per band;
      // the first band that reads replaces the empty card. If no
      // band reads, the empty-read card is restored as it was.
      let accepted = false;
      for (const bt of bands.texts) {
        if (isEmptyRead(bt)) continue;
        const rescued = runExtraction(bt, namedType);
        if (rescued && (Object.keys(rescued.result.fields).length > 0 || rescued.docType !== "other")) { accepted = true; break; }
      }
      if (!accepted) runExtraction(text, namedType);
      setOcrNote(null);
      return;
    }
    const merged: Record<string, number | string> = { ...f };
    const mergedConf: Record<string, number> = { ...r.result.fieldConfidence };
    let added = 0;
    for (const bt of bands.texts) {
      const br = extractOnly(bt, r.docType);
      for (const [k, v] of Object.entries(br.fields)) {
        if (merged[k] === undefined && v !== undefined) {
          merged[k] = v;
          mergedConf[k] = br.fieldConfidence[k] ?? 0.5;
          added++;
        }
      }
      if (r.docType === "payslip" && typeof merged.ytd_federal_withheld === "number" && typeof merged.ytd_taxable_wages === "number") break;
    }
    if (added > 0) {
      setExtraction({ ...r.result, fields: merged, fieldConfidence: mergedConf });
      setOcrNote(`${label}the section re-read found ${added} more figure${added === 1 ? "" : "s"} - please check the full reading below.`);
    } else {
      setOcrNote(null);
    }
  };

  const reextractAs = (docType: string) => {
    if (pendingText === null) return;
    // A CSV reading switches freely between the two statement types
    // (the summary is the reading); any other type drops the summary
    // and re-reads through the normal pipeline.
    if (pendingSpending && (docType === "bank_statement" || docType === "card_statement")) {
      setExtractionType(docType);
      return;
    }
    if (pendingSpending) setPendingSpending(null);
    try {
      const colFlat = pendingColumns ? pendingColumns.flat() : [];
      const formNow = parseSaForm(pendingText);
      let raw = [...textToRawFields(pendingText), ...colFlat];
      if (docType === "payslip") {
        const slip = parsePayslipRows(pendingText);
        if (slip.fields.length > 0) {
          const restText = dropConsumedLines(pendingText, slip.consumedLines);
          raw = [...slip.fields, ...textToRawFields(restText), ...colFlat];
        }
      }
      if (formNow && formNow.kind === docType) raw = [...formNow.fields, ...raw];
      setExtraction(extractFields(raw, docType));
      setExtractionType(docType);
      setPending401kDetail(docType === "401k_statement" ? parse401kDetail(pendingText) : null);
      setPendingSaForm(formNow);
    } catch (e) {
      setOcrNote(e instanceof Error ? e.message : String(e));
    }
  };

  // --- Round 56 intake queue -------------------------------------
  // Every image, from EVERY picker, goes through the same OCR
  // pipeline for its platform (web: webOcr via recognizeImageFile;
  // native: ML Kit via recognizeOnDevice) - the picker that
  // delivered the image no longer decides how it is read. The one
  // divergence found in this round's trace: the web CAMERA path
  // handed its photo to recognizeOnDevice, which refuses to run on
  // web at all; scanPhoto now converts the camera result to a File
  // so it takes the web pipeline like any other image.
  // A read failure stops the queue and shows the failure CARD
  // (intakeFailure) with the cause in plain words; the three OCR
  // causes are worded differently on purpose (defect 3).
  const failIntake = (heading: string, body: string, remainingAfter: number): false => {
    setFlowNote(null);
    setIntakeBatch(null);
    setIntakeFailure({
      heading,
      body: remainingAfter > 0 ? `${body} The rest of the batch was not read - pick the remaining items again.` : body,
    });
    return false;
  };

  const ocrFailureCard = (outcome: { stage: string; error: string | null; failure?: string | null }, remainingAfter: number): false => {
    if (outcome.failure === "decode") {
      return failIntake(
        "This image could not be processed",
        "HomeTower could not open this image at all, so nothing could be read from it. The file may be damaged, or in a format the browser cannot decode. Try a different copy of the image, or a fresh screenshot.",
        remainingAfter,
      );
    }
    return failIntake(
      "Text recognition failed",
      `HomeTower's reading engine stopped before it could read this image (stage: ${outcome.stage}${outcome.error ? ` - ${outcome.error}` : ""}). Nothing was saved. Try again; if it keeps failing, send the document as a PDF instead.`,
      remainingAfter,
    );
  };

  // One picked FILE (web path). Returns true when a reading - or
  // the empty-read confirm card - is on screen; false when the read
  // failed loudly and any queue must stop.
  const processOneFile = async (f: File, namedType?: string, batchLabel?: string, remainingAfter = 0): Promise<boolean> => {
    if (/\.csv$/i.test(f.name) || f.type.includes("csv")) {
      const text = await f.text();
      setFlowNote(null);
      if (!startCsvReading(text, f.name, namedType)) {
        return failIntake(
          "That CSV could not be read as a statement",
          `HomeTower needs Date, Description and Amount (or Debit/Credit) columns in ${f.name}. Nothing was saved; the statement can be registered manually below.`,
          remainingAfter,
        );
      }
      return true;
    }
    if (f.type.includes("pdf") || /\.pdf$/i.test(f.name)) {
      const outcome = await extractPdfTextFromBuffer(await f.arrayBuffer());
      if (outcome.error) {
        return failIntake("HomeTower could not read this PDF", `${f.name}: ${outcome.error}`, remainingAfter);
      }
      setFlowNote(null);
      runExtraction(outcome.text, namedType, outcome.pages, outcome.columnByPage);
      return true;
    }
    if (isImageFile(f)) {
      const outcome = await recognizeImageFile(f, batchLabel ? (pct) => setOcrNote(`${batchLabel} - reading ${pct}%`) : undefined);
      if (outcome.failure === "decode" || outcome.failure === "engine") return ocrFailureCard(outcome, remainingAfter);
      if (outcome.error && outcome.failure !== "no_text") return ocrFailureCard(outcome, remainingAfter);
      // A successful read - and a completed read that found no text
      // - both go through the normal pipeline. Empty text lands on
      // the empty-read confirm card, which says what happened.
      setFlowNote(null);
      await runImageExtraction(outcome.text, namedType, f, batchLabel);
      return true;
    }
    return failIntake(
      "That file type cannot be read",
      `${f.name} is not a PDF, a CSV or a photo - HomeTower reads PDFs, statement CSVs and photos. Nothing was saved; the file can be registered manually below.`,
      remainingAfter,
    );
  };

  // One picked item identified by URI (native path).
  const processOneUri = async (uri: string, name: string, namedType?: string, remainingAfter = 0): Promise<boolean> => {
    if (/\.csv$/i.test(name)) {
      try {
        const text = await (await fetch(uri)).text();
        setFlowNote(null);
        if (!startCsvReading(text, name, namedType)) {
          return failIntake(
            "That CSV could not be read as a statement",
            "HomeTower needs Date, Description and Amount (or Debit/Credit) columns. Nothing was saved; the statement can be registered manually below.",
            remainingAfter,
          );
        }
        return true;
      } catch {
        return failIntake(
          "CSV reading is not available here",
          "CSV statement reading runs in the web app for now - in the phone app, register the statement manually below; it still counts toward your spending evidence.",
          remainingAfter,
        );
      }
    }
    if (/\.pdf$/i.test(name)) {
      const outcome = await extractPdfText(uri);
      if (outcome.error) {
        return failIntake("HomeTower could not read this PDF", `PDF stage: ${outcome.error}`, remainingAfter);
      }
      setFlowNote(null);
      runExtraction(outcome.text, namedType, outcome.pages, outcome.columnByPage);
      return true;
    }
    const outcome = await recognizeOnDevice(uri);
    if (outcome.failure === "decode" || outcome.failure === "engine") return ocrFailureCard(outcome, remainingAfter);
    if (outcome.error && outcome.failure !== "no_text") return ocrFailureCard(outcome, remainingAfter);
    setFlowNote(null);
    runExtraction(outcome.text, namedType);
    return true;
  };

  const processIntakeItem = async (item: IntakeItem, namedType?: string, batchLabel?: string, remainingAfter = 0): Promise<boolean> => {
    if ("file" in item) return processOneFile(item.file, namedType, batchLabel, remainingAfter);
    return processOneUri(item.uri, item.name, namedType, remainingAfter);
  };

  const startIntakeBatch = async (items: IntakeItem[], namedType: string | undefined, noun: "File" | "Screenshot") => {
    batchSaveRef.current = null;
    setIntakeFailure(null);
    if (items.length === 1) {
      setIntakeBatch(null);
      await processIntakeItem(items[0], namedType);
      return;
    }
    setIntakeBatch({ queue: items.slice(1), namedType, total: items.length, done: 1, noun });
    setOcrNote(`Reading ${noun.toLowerCase()} 1 of ${items.length} - confirm or discard each reading; the next one follows automatically.`);
    await processIntakeItem(items[0], namedType, `${noun} 1 of ${items.length}`, items.length - 1);
  };

  const advanceIntakeBatch = () => {
    if (!intakeBatch || intakeBatch.queue.length === 0) { setIntakeBatch(null); return; }
    const [next, ...rest] = intakeBatch.queue;
    const nb = { queue: rest, namedType: intakeBatch.namedType, total: intakeBatch.total, done: intakeBatch.done + 1, noun: intakeBatch.noun };
    setIntakeBatch(nb);
    void processIntakeItem(next, nb.namedType, `${nb.noun} ${nb.done} of ${nb.total}`, rest.length);
  };

  const scanPhoto = async (source: "upload" | "camera", namedType?: string) => {
    setOcrNote(null);
    setIntakeFailure(null);
    if (source === "camera") {
      const { uri, error } = await takePhotoUri();
      if (error) { setOcrNote(error); return; }
      if (!uri) return;
      if (Platform.OS === "web") {
        // Round 56: on web the camera shim hands back a blob/data
        // URL, and recognizeOnDevice refuses to run on web - the
        // photo used to die at that stage. Convert it to a File so
        // it takes the SAME web OCR pipeline as every other image.
        try {
          const blob = await (await fetch(uri)).blob();
          const file = new File([blob], "camera-photo.jpg", { type: blob.type || "image/jpeg" });
          await processIntakeItem({ file }, namedType);
        } catch {
          setIntakeFailure({
            heading: "This image could not be processed",
            body: "The camera photo did not arrive in a form HomeTower could open. Try again, or pick the photo from the library instead.",
          });
        }
        return;
      }
      await processIntakeItem({ uri, name: "camera-photo" }, namedType);
      return;
    }
    // Web (owner QA round 25): the photo-library shim resolves empty
    // inside an iOS standalone web app - the user picks, taps the
    // checkmark, and nothing arrives, silently. Web therefore picks
    // through the platform file input (filePick.web) and reads with
    // web OCR; a cancel is reported, never silent.
    if (Platform.OS === "web") {
      const picked = await pickImageFiles();
      if (picked.error) { setOcrNote(picked.error); return; }
      if (picked.cancelled || !picked.files.length) {
        setOcrNote("No photo reached HomeTower - the picker closed without a selection arriving. Please try again.");
        return;
      }
      await startIntakeBatch(picked.files.map((file) => ({ file })), namedType, "Screenshot");
      return;
    }
    const { uris, error } = await pickImageUris();
    if (error) { setOcrNote(error); return; }
    if (!uris.length) {
      setOcrNote("No photo reached HomeTower - the picker closed without a selection arriving. Please try again.");
      return;
    }
    await startIntakeBatch(uris.map((uri) => ({ uri, name: "photo" })), namedType, "Screenshot");
  };

  // Owner QA round 6: a real FILE upload. The image picker greys PDFs
  // out; tax documents are PDFs. PDFs are read through their text layer
  // (web), images through the OCR path, anything else gets a plain
  // explanation plus the manual-register option below.
  // Owner QA round 9: the picker is the platform file input (see
  // filePick.web.ts - the library shim returned nothing on iOS), and
  // EVERY step reports into flowNote: picker opened -> files received
  // (by name) -> reading -> result or the exact failure card.
  // Round 56 (defect 1): SEVERAL files can be picked together; they
  // enter the intake queue and are confirmed one at a time, in pick
  // order - the same discipline the photo batch has had since
  // round 25.
  const uploadFiles = async (namedType?: string) => {
    setFlowNote("Opening the file picker...");
    setIntakeFailure(null);
    try {
      const picked = await pickFiles();
      if (picked.error) { setFlowNote(picked.error); return; }
      if (picked.cancelled || !picked.files.length) {
        setFlowNote("No file reached HomeTower - the picker closed without a selection arriving. Please try again.");
        return;
      }
      const names = picked.files.map((p) => p.name).join(", ");
      setFlowNote(
        picked.files.length === 1
          ? `Received ${names} - reading it now...`
          : `Received ${picked.files.length} files (${names}) - reading them one at a time; each reading is confirmed before the next begins.`,
      );
      const items: IntakeItem[] = picked.files.map((p) =>
        p.file ? { file: p.file } : { uri: p.uri as string, name: p.name },
      );
      await startIntakeBatch(items, namedType, "File");
    } catch (e) {
      setFlowNote(e instanceof Error ? e.message : String(e));
    }
  };

  // Scroll to the TOP of the confirm card when a reading lands: the
  // card is tall, and scrolling to the end of the page hid its header
  // (and the batch progress line) above the viewport - owner QA
  // round 26: the "1 of X" indicator existed but was never seen.
  useEffect(() => {
    if (extraction) {
      const t = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, confirmY.current - 8), animated: true }), 120);
      return () => clearTimeout(t);
    }
  }, [extraction]);

  // Same scroll courtesy for the round-56 failure card: a loud
  // failure the user never sees is not loud.
  useEffect(() => {
    if (intakeFailure) {
      const t = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, failureY.current - 8), animated: true }), 120);
      return () => clearTimeout(t);
    }
  }, [intakeFailure]);

  const confirmExtraction = () => {
    if (!extraction) return;
    const savedFields: Record<string, string> = Object.fromEntries(Object.entries(extraction.fields).map(([k, v]) => [k, String(v)]));
    if (extractionType === "brokerage_statement" && pendingHoldings && pendingHoldings.cash !== null && savedFields["cash_balance"] === undefined) {
      savedFields["cash_balance"] = String(pendingHoldings.cash);
    }
    if (extractionType === "brokerage_statement" && pendingPlan) {
      savedFields["account_ticker"] = pendingPlan.ticker;
      if (pendingPlan.company) savedFields["account_company"] = pendingPlan.company;
      // Vested share count, derived from the vested balance and the
      // plan's own last price (780.0 shares exactly on the owner's
      // INTC plan) - the market-close report counts vested shares
      // only, and this is where the count comes from.
      const vested = Number(extraction.fields["vested_balance"]);
      if (Number.isFinite(vested) && vested > 0 && pendingPlan.lastPrice && pendingPlan.lastPrice > 0) {
        savedFields["plan_shares"] = String(Math.round((vested / pendingPlan.lastPrice) * 1000) / 1000);
      }
    }
    if (extractionType === "payslip") {
      // A bonus run ("On Demand Payment") is not a regular pay cycle:
      // its YTD is the freshest anchor, but its per-period figures
      // must never become the run rate. The projection keeps the two
      // apart by this marker.
      savedFields["payslip_kind"] = pendingText && /on demand/i.test(pendingText) ? "bonus" : "regular";
    }
    // Round 55 (workstream F): the 401(k) detail facts are saved
    // with the record, and statement records carry their period end
    // so provenance can resolve per field by as-of date.
    if (extractionType === "401k_statement" && pending401kDetail) {
      Object.assign(savedFields, k401DetailFields(pending401kDetail));
    }
    if (pendingText && ["401k_statement", "529_statement", "hsa_statement"].includes(extractionType) && !savedFields["statement_as_of"]) {
      const period = statementPeriodOf(pendingText);
      if (period) savedFields["statement_as_of"] = period.endIso;
    }
    // Round 55 (workstream E): an SA tax form saves its boxes as a
    // structured set plus its tax year, account and source date.
    // These are historical tax facts - saving one changes no
    // current balance anywhere (balances resolve from statements).
    let formBoxes: Record<string, string> | undefined;
    if (pendingSaForm && pendingSaForm.kind === extractionType) {
      if (pendingSaForm.taxYear) savedFields["tax_year"] = String(pendingSaForm.taxYear);
      if (pendingSaForm.accountId) savedFields["account_id"] = pendingSaForm.accountId;
      if (pendingSaForm.accountOwner) savedFields["account_owner"] = pendingSaForm.accountOwner;
      if (pendingSaForm.sourceDate) savedFields["source_date"] = pendingSaForm.sourceDate;
      formBoxes = {};
      for (const [k, v] of Object.entries(savedFields)) if (k.startsWith("box_")) formBoxes[k] = v;
    }
    const ssaOwner = extractionType === "ssa_statement" ? (assignMemberId ?? (adults.length === 1 ? adults[0].id : null)) : null;
    const k401Owner = extractionType === "401k_statement" ? (assign401kMemberId ?? (adults.length === 1 ? adults[0].id : null)) : null;
    const eduOwner = extractionType === "529_statement" ? (assignChildId ?? null) : null;
    const docOwner = ssaOwner ?? k401Owner ?? eduOwner;
    const record: DocumentRecord = {
      docType: extractionType,
      status: extraction.status,
      confidence: extraction.confidence,
      capturedOn: today,
      fields: savedFields,
      ...(docOwner ? { ownerMemberId: docOwner } : {}),
      ...(extractionType === "brokerage_statement" && pendingHoldings && pendingHoldings.positions.length > 0 ? { holdings: pendingHoldings.positions } : {}),
      ...(pendingSpending && (extractionType === "bank_statement" || extractionType === "card_statement")
        ? { spendingSummary: { months: pendingSpending.months, byCategory: pendingSpending.byCategory } }
        : {}),
      // Round 55 (workstream G): the extracted text is retained
      // (bounded) with the maps version that read it, so a later
      // reader improvement can re-read this document on load.
      // Round 58: the retained text's fingerprint is stamped too -
      // it is this reading's identity for dedupe on re-upload.
      ...(pendingText ? { rawText: boundRawText(pendingText), mapsVersion: String(ocrMapsPack().version ?? ""), extractorVersion: EXTRACTOR_VERSION, ...(fingerprintForSave(boundRawText(pendingText)) ? { fingerprint: fingerprintForSave(boundRawText(pendingText)) } : {}) } : {}),
      uploadId: `up-${Date.now()}`,
      ...(formBoxes ? { formBoxes } : {}),
    };
    // ROUND 60 (P0-B): canonical validation BEFORE any save path.
    // Dedupe (upsertDocument) prevents a duplicate fact; this
    // layer prevents a WRONG one - a reading whose balance is a
    // known 401(k) balance, or whose HSA identity does not hold
    // up, is not saved at all, and the confirm card shows why.
    const validation = validateCanonicalEvidence({ proposedRecord: record, existingDocuments: docs, householdAccounts: state.assets });
    if (validation.status === "needs_review") {
      setSaveBlock(validation.reasons);
      return;
    }
    setSaveBlock(null);
    // Multi-page payslips (owner, 2026-11-08): a slip spans several
    // screenshots. Inside one batch, a reading whose earner + period
    // match the payslip saved from the previous screenshot is a PAGE
    // of that slip - merge into it, never a second document (an
    // unmerged page 2, which carries the taxable-wages table but no
    // withholding totals, would poison the forecast's anchor pick).
    let mergedNote = "";
    let handled = false;
    if (extractionType === "payslip" && intakeBatch) {
      const key = payslipKey(savedFields);
      const prev = batchSaveRef.current;
      if (key !== "" && prev && prev.key === key && docs[prev.index]?.docType === "payslip") {
        const mergedRecord: DocumentRecord = {
          ...docs[prev.index],
          fields: mergePayslipFields(docs[prev.index].fields ?? {}, savedFields),
          status: docs[prev.index].status === "parsed" || extraction.status === "parsed" ? "parsed" : extraction.status,
          confidence: Math.max(docs[prev.index].confidence, extraction.confidence),
        };
        updateIntake({ documents: docs.map((d, i) => (i === prev.index ? mergedRecord : d)) });
        mergedNote = ` Merged with the previous screenshot - same payslip (${savedFields["employee_name"] ?? "same earner"}, period ending ${savedFields["pay_period_end"] ?? ""}); its pages are now ONE document.`;
        handled = true;
      }
    }
    // Round 58: EVERY save goes through the one dedupe path
    // (upsertDocument in reconcile.ts). A re-upload of a document
    // HomeTower already holds - the same file again, or a corrected
    // reading of the same payslip (earner + period end), statement
    // (account or owner + period end) or tax form (type + tax year
    // + account) - refreshes the existing record in its place and
    // never stacks a duplicate. The confirm card showed exactly the
    // fields that take over, so nothing is lost silently. (This is
    // the repeat-payslip rule of 2026-11-08 and the round-55
    // statement rule, generalized to one path for every kind.)
    // Within one photo batch the page merge above still assembles
    // a multi-page slip first.
    if (!handled) {
      const up = upsertDocument(docs, record);
      updateIntake({ documents: up.docs });
      handled = true;
      if (up.refreshed) {
        mergedNote = extractionType === "payslip"
          ? ` Already on file - HomeTower refreshed the existing reading of this payslip (${savedFields["employee_name"] ?? "same earner"}, period ending ${savedFields["pay_period_end"] ?? ""}). No duplicate was created.`
          : ` Already on file - HomeTower refreshed the existing reading${savedFields["statement_as_of"] ? ` (period ending ${savedFields["statement_as_of"]})` : ""}. No duplicate was created.`;
      }
      if (extractionType === "payslip" && intakeBatch) {
        const key = payslipKey(savedFields);
        if (key !== "") batchSaveRef.current = { key, index: up.index };
      }
    }
    if (extractionType === "payslip") update({ payrollCheck: { lastConfirmedOn: null, consecutive: 0 } });
    let assignNote = "";
    if (extractionType === "529_statement" && assignChildId) {
      const child = state.family.find((m) => m.id === assignChildId);
      const bal = Number(extraction.fields["ending_balance"]);
      const mo = Number(extraction.fields["monthly_contribution"]);
      if (child && (Number.isFinite(bal) && bal > 0)) {
        const patch: Record<string, number> = { eduBalance: bal };
        if (Number.isFinite(mo) && mo > 0) patch.eduMonthly = mo;
        update({ family: state.family.map((m) => (m.id === assignChildId ? { ...m, ...patch } : m)) });
        assignNote = ` Filled ${child.name || "the child"}'s college funding from this statement: saved $${bal.toLocaleString("en-US")}${patch.eduMonthly ? `, monthly $${patch.eduMonthly.toLocaleString("en-US")}` : " (the statement shows no monthly contribution - the monthly figure stays as it was)"}.`;
        setAssignChildId(null);
      } else if (child) {
        assignNote = ` Saved, but no balance could be read from it, so ${child.name || "the child"}'s college funding was not filled.`;
      }
    }
    if (extractionType === "ssa_statement") {
      const benefit = Number(extraction.fields["monthly_benefit_estimate"]);
      const owner = ssaOwner ? state.family.find((m) => m.id === ssaOwner) : undefined;
      if (owner && Number.isFinite(benefit) && benefit > 0) {
        assignNote = ` Saved as ${owner.name || "the adult"}'s Social Security statement: the estimated benefit ($${benefit.toLocaleString("en-US")}/month at full retirement age) now counts as their dependable income on Home and the Retirement Lifestyle page, unless they type a figure of their own.`;
      } else if (owner) {
        assignNote = ` Saved as ${owner.name || "the adult"}'s Social Security statement, but no monthly benefit could be read from it, so nothing counts as Social Security yet.`;
      } else {
        assignNote = ` Saved without an owner - pick whose statement it is so its benefit can count as that adult's Social Security.`;
      }
      setAssignMemberId(null);
    }
    if (extractionType === "401k_statement") {
      const bal = Number(extraction.fields["ending_balance"]);
      const owner = k401Owner ? state.family.find((m) => m.id === k401Owner) : undefined;
      if (owner && Number.isFinite(bal) && bal > 0) {
        assignNote = ` Saved as ${owner.name || "the adult"}'s 401(k) statement: its ending balance ($${bal.toLocaleString("en-US")}) is now the starting balance of their 401(k) in the retirement outlook on Home, replacing the 401(k) figure entered for them in My House so the account is never counted twice. Their payslip pace still sets future contributions.`;
      } else if (owner) {
        assignNote = ` Saved as ${owner.name || "the adult"}'s 401(k) statement, but no ending balance could be read from it, so their retirement outlook balance is unchanged.`;
      } else {
        assignNote = ` Saved without an owner - pick whose statement it is so its ending balance can count as that adult's 401(k) starting balance.`;
      }
      setAssign401kMemberId(null);
    }
    setExtraction(null);
    setDetection(null);
    setPendingText(null);
    setPendingHoldings(null);
    setPendingPlan(null);
    setPendingSpending(null);
    setPending401kDetail(null);
    setPendingSaForm(null);
    setPasteText("");
    setAutoPaste("");
    const moreComing = intakeBatch && intakeBatch.queue.length > 0 ? ` ${intakeBatch.noun} ${intakeBatch.done + 1} of ${intakeBatch.total} is being read now.` : "";
    setOcrNote(`Saved ${extractionType} (${extraction.status}, confidence ${extraction.confidence}).${assignNote}${mergedNote}${moreComing}`);
    advanceIntakeBatch();
  };

  // Round 55 (workstreams A + C): save every detected account as
  // its own document, linked to the one upload. Re-saving the same
  // account's statement for the same period replaces the earlier
  // reading (the payslip discipline, per account). A 529 reading
  // with a child assigned refreshes that child's education funding
  // - balance and monthly pace move from the statement itself, per
  // child, independently.
  const confirmFanOut = () => {
    if (!fanOut) return;
    const uploadId = `up-${Date.now()}`;
    const version = String(ocrMapsPack().version ?? "");
    let newDocs = [...docs];
    let refreshedCount = 0;
    const eduPatch = new Map<string, { eduBalance: number; eduMonthly?: number }>();
    const savedNames: string[] = [];
    const blockedNotes: string[] = [];
    for (const fs of fanOut.sections) {
      const fields: Record<string, string> = Object.fromEntries(Object.entries(fs.fields).map(([k, v]) => [k, String(v)]));
      if (fanOut.period) fields["statement_as_of"] = fanOut.period.endIso;
      if (fs.section.kind === "529" && fs.section.personName) fields["beneficiary_name"] = fs.section.personName;
      const owner = fs.section.kind === "529" ? fs.childId : fs.memberId;
      const sectionText = boundRawText(fs.section.text);
      const record: DocumentRecord = {
        docType: fs.section.docType,
        status: fs.status as DocumentRecord["status"],
        confidence: fs.confidence,
        capturedOn: today,
        fields,
        ...(owner ? { ownerMemberId: owner } : {}),
        uploadId,
        accountId: fs.section.accountId,
        rawText: sectionText,
        mapsVersion: version,
        extractorVersion: EXTRACTOR_VERSION,
        ...(fingerprintForSave(sectionText) ? { fingerprint: fingerprintForSave(sectionText) } : {}),
      };
      // ROUND 60 (P0-B): canonical validation before the save, the
      // same layer as the single-reading path - a section whose
      // balance is a known 401(k) balance, or whose HSA identity
      // does not hold up, is not saved, and the completion note
      // says so with the reason.
      const validation = validateCanonicalEvidence({ proposedRecord: record, existingDocuments: newDocs, householdAccounts: state.assets });
      if (validation.status === "needs_review") {
        blockedNotes.push(`${fs.section.kind === "529" ? `529 for ${fs.section.personName ?? "a beneficiary"}` : "The HSA reading"} was not saved: ${validation.reasons[0]}`);
        continue;
      }
      // Round 58: the same single dedupe path as every other save -
      // re-saving the same account's statement for the same period
      // refreshes that account's reading in place.
      const up = upsertDocument(newDocs, record);
      newDocs = up.docs;
      if (up.refreshed) refreshedCount++;
      savedNames.push(fs.section.kind === "529" ? `529 for ${fs.section.personName ?? "a beneficiary"}` : "the HSA");
      if (fs.section.kind === "529" && fs.childId) {
        const bal = Number(fs.fields["ending_balance"]);
        const mo = Number(fs.fields["monthly_contribution"]);
        if (Number.isFinite(bal) && bal > 0) {
          eduPatch.set(fs.childId, { eduBalance: bal, ...(Number.isFinite(mo) && mo > 0 ? { eduMonthly: mo } : {}) });
        }
      }
    }
    updateIntake({ documents: newDocs });
    if (eduPatch.size) {
      update({ family: state.family.map((m) => (eduPatch.has(m.id) ? { ...m, ...eduPatch.get(m.id)! } : m)) });
    }
    const n = savedNames.length;
    setFanOut(null);
    setPendingText(null);
    const moreComing = intakeBatch && intakeBatch.queue.length > 0 ? ` ${intakeBatch.noun} ${intakeBatch.done + 1} of ${intakeBatch.total} is being read now.` : "";
    const refreshNote = refreshedCount > 0 ? ` ${refreshedCount} of these readings were already on file - HomeTower refreshed them in place. No duplicates were created.` : "";
    const blockedNote = blockedNotes.length > 0 ? `${blockedNotes.join(" ")} ` : "";
    setOcrNote(n > 0
      ? `${blockedNote}Saved ${n} account reading${n === 1 ? "" : "s"} from one document (${savedNames.join("; ")}). Each account keeps its own balance, contributions and distributions - the document's combined total was not saved as any account's balance.${refreshNote} Check the Tasks page: distributions start their reconciliation there.${moreComing}`
      : `${blockedNote}Nothing from this document was saved.${moreComing}`);
    advanceIntakeBatch();
  };

  const addManual = () => {
    updateIntake({ documents: [...docs, { docType: selectedType, status: "parsed", confidence: 1, capturedOn: today }] });
    if (selectedType === "payslip") update({ payrollCheck: { lastConfirmedOn: null, consecutive: 0 } });
  };
  const removeDoc = (index: number) => updateIntake({ documents: docs.filter((_, i) => i !== index) });

  // --- Ongoing center model -------------------------------------------
  const payCycleDays = (() => {
    const f = state.jobs.find((j) => !j.endDate)?.payFrequency ?? state.intake.members[0]?.payFrequency ?? "biweekly";
    return f === "weekly" ? 7 : f === "semimonthly" ? 15 : f === "monthly" ? 30 : 14;
  })();
  interface CatDef { key: string; icon: string; name: string; docType: string; cadence: string; extra?: string }
  const CATS: CatDef[] = [
    { key: "payslip", icon: "🧾", name: "Payslips", docType: "payslip", cadence: `every ~${payCycleDays} days (pay cycle)` },
    { key: "brokerage", icon: "📈", name: "Stocks & brokerage", docType: "brokerage_statement", cadence: "monthly", extra: "Needed for concentration + TaxImpact" },
    { key: "401k", icon: "🏦", name: "401(k)", docType: "401k_statement", cadence: "every ~90 days" },
    { key: "pension", icon: "🏛️", name: "Pension", docType: "pension_statement", cadence: "yearly" },
    { key: "hsa", icon: "🩺", name: "HSA", docType: "hsa_statement", cadence: "every ~90 days" },
    { key: "529", icon: "🎓", name: "529 education", docType: "529_statement", cadence: "every ~90 days" },
  ];
  const catInfo = (c: CatDef) => {
    const ofType = docs.filter((d) => d.docType === c.docType);
    const latest = ofType.length ? [...ofType].sort((a, b) => (b.capturedOn ?? "").localeCompare(a.capturedOn ?? ""))[0] : null;
    const f = latest ? documentFreshness(latest, today) : null;
    const status = !latest ? "missing" : f!.status === "unknown" ? "missing" : f!.status;
    const window = FRESHNESS_WINDOW_DAYS[c.docType] ?? 180;
    const overdue = status === "stale" && f?.ageDays != null ? f.ageDays - window : 0;
    const rank = status === "stale" ? 0 : status === "missing" ? 1 : status === "aging" ? 2 : 3;
    return { ofType, latest, status, overdue, rank };
  };
  const chipFor = (s: string) =>
    s === "stale" ? { t: "STALE - update", bg: "#FDE3DF", fg: "#A02C1D" }
    : s === "aging" ? { t: "AGING", bg: "#FDF0DA", fg: "#8A5A00" }
    : s === "missing" ? { t: "MISSING", bg: "#E5EBF1", fg: "#44566B" }
    : { t: "UP TO DATE", bg: "#DDF3E8", fg: "#0C6B4A" };
  // ROUND 52 - provenance lines on the document-derived cards: an
  // item no document carries is "Unknown" (no document) or "Not
  // detected" (documents exist, item absent) - never a $0. The
  // employer match resolves household-wide here (payslip pace
  // first, then any member's owned statement); ESPP and HSA read
  // off the payslips via payslipDeductionTotals.
  const dedTotals = useMemo(() => payslipDeductionTotals(docs, today, state.jobs), [docs, today, state.jobs]);
  // ROUND 62 (R62-5 + R62-7): the developer diagnostics - runtime
  // invariant verdicts over canonical state, and the KPI lineage
  // ("Why this number?") traces. Developer-only: collapsed behind
  // one row at the bottom of this screen's model, rendered in the
  // diagnostics block after the re-read banner.
  const invariantResults = useMemo(() => runInvariants(state, today), [state, today]);
  const lineageTraces = useMemo(() => kpiLineage(state, today), [state, today]);
  const [showDiag, setShowDiag] = useState(false);
  const matchHouseholdLine = (() => {
    const k = payslip401kTotals(docs, today);
    const slipMatch = k ? k.perEarner.reduce<number | null>((acc, e) => (e.matchMonthlyPace === null ? acc : (acc ?? 0) + e.matchMonthlyPace), null) : null;
    let stmt: ReturnType<typeof k401StatementMatchFor> = null;
    for (const m of state.family) {
      const s = k401StatementMatchFor(docs, m.id);
      if (s && (!stmt || (s.capturedOn ?? "") >= (stmt.capturedOn ?? ""))) stmt = s;
    }
    const res = employerMatchFor({ payslipMonthly: slipMatch, statement: stmt, relevantDocsExist: docs.some((d) => d.docType === "payslip" || d.docType === "401k_statement") });
    // ROUND 59 (TRACE E): the statement confirms a year-to-date
    // total; the monthly pace is a derivation from it and the line
    // labels it as one (statementMatchLine) - the old wording
    // presented the derived pace as the headline figure with a
    // bare source label, as if the statement stated it.
    if (res.monthly > 0 && res.status === "from_statement" && stmt) return statementMatchLine({ periodTotal: stmt.periodTotal, months: stmt.months, monthly: res.monthly, statementLabel: monthYearLabel(res.statementOn) });
    if (res.monthly > 0) return `Employer match: $${Math.round(res.monthly).toLocaleString("en-US")}/mo (from your payslips)`;
    if (res.detectedNotPaced && stmt) return `Employer match: $${Math.round(stmt.periodTotal).toLocaleString("en-US")} on a 401(k) statement (${monthYearLabel(res.statementOn)}) - its period is not stated, so no monthly pace is counted yet`;
    if (res.status === "not_detected") return "Employer match: Not detected on your payslips - a 401(k) statement would show it";
    return "Employer match: Unknown - no payslip or 401(k) statement yet";
  })();
  // ROUND 59 (TRACE C, Copilot's remedy shape): the HSA card no
  // longer blends every earner's payroll HSA into one figure
  // presented as the account's. The reconciliation model keeps
  // the statement's confirmed YTD separate from payroll YTD,
  // breaks payroll down by owner, and names the delta; an
  // unexplained delta also overrides the card's status chip
  // below (no UP TO DATE over a disagreement).
  const hsaRecon = hsaContributionReconciliation(docs, dedTotals.perEarner, state.family);
  const hsaLines: string[] = (() => {
    const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const lines: string[] = [];
    if (hsaRecon.ownerPayrollYtd !== null && hsaRecon.ownerName) {
      lines.push(`${hsaRecon.ownerName.split(" ")[0]} payroll HSA YTD ${money2(hsaRecon.ownerPayrollYtd)}`);
    } else if (dedTotals.hsaYtd > 0) {
      lines.push(`Payroll HSA YTD ${money2(dedTotals.hsaYtd)} (from your payslips)`);
    }
    if (hsaRecon.otherHouseholdYtd > 0) lines.push(`Other household HSA YTD ${money2(hsaRecon.otherHouseholdYtd)}`);
    if (hsaRecon.statementYtd !== null) lines.push(`Statement confirmed YTD ${money2(hsaRecon.statementYtd)}`);
    if (hsaRecon.delta !== null) {
      lines.push(hsaRecon.explained
        ? `Reconciliation delta ${money2(hsaRecon.delta)} - payroll and the statement agree`
        : `Reconciliation delta ${money2(hsaRecon.delta)} - not yet explained: the payslips and the statement on file disagree, so check which one is current`);
    }
    if (!lines.length) {
      const st = docEvidenceStatus(docs, "hsa");
      if (st === "from_statement") return ["HSA contributions: on your HSA statement"];
      if (st === "not_detected") return ["HSA contributions: Not detected on your payslips"];
      return ["HSA contributions: Unknown - no payslip or HSA statement yet"];
    }
    if (dedTotals.hsaMonthlyPace !== null) {
      const pacers = dedTotals.perEarner.filter((e) => e.hsaMonthlyPace !== null);
      const who = pacers.length === 1 ? ` (${pacers[0].name.split(" ")[0]}'s payslips)` : " (from your payslips)";
      lines.push(`Payroll pace: $${Math.round(dedTotals.hsaMonthlyPace)}/mo${who}`);
    }
    // ROUND 60 (P1-C): the HSA domain's own accuracy level, from
    // its own evidence - not the global completeness score.
    const hsaDomain = hsaAccuracy(
      docs.some((d) => d.docType === "hsa_statement" && d.status === "parsed"),
      hsaRecon.delta !== null ? hsaRecon.explained : null,
    );
    lines.push(`HSA accuracy: ${hsaDomain.label} (${hsaDomain.level}) - ${hsaDomain.basis}`);
    return lines;
  })();
  const edu529Line = (() => {
    // ROUND 59 (TRACE D): the headline is the household pace -
    // the freshest statement's monthly contribution PER CHILD,
    // summed (eduMonthlyTotal). The old loop kept whichever
    // statement record was iterated LAST, so the headline showed
    // one child's $150 while the per-child lines below correctly
    // showed 350 / 200 / 150.
    const pace = eduMonthlyTotal(docs, state.family.filter((m) => m.role === "child"));
    if (pace.total > 0) {
      return pace.perChild.length === 1
        ? `529 contributions: $${Math.round(pace.total).toLocaleString("en-US")}/mo (from your 529 statement)`
        : `529 contributions: $${Math.round(pace.total).toLocaleString("en-US")}/mo across ${pace.perChild.length} children (from your 529 statements)`;
    }
    const st = docEvidenceStatus(docs, "529");
    if (st === "not_detected") return "529 contributions: Not detected on your statements";
    return "529 contributions: Unknown - no 529 statement yet";
  })();
  const esppLine = (() => {
    const hasEvent = state.events.some((e) => e.kind === "espp_purchase");
    const st = docEvidenceStatus(docs, "espp");
    if (st === "from_payslip" && dedTotals && dedTotals.esppYtd > 0) return `ESPP: $${Math.round(dedTotals.esppYtd).toLocaleString("en-US")} contributed so far this year (from your payslips)${dedTotals.esppMonthlyPace ? ` · running at $${Math.round(dedTotals.esppMonthlyPace).toLocaleString("en-US")}/mo` : ""}`;
    if (hasEvent) return "ESPP: purchases recorded as events below";
    if (st === "not_detected") return "ESPP: Not detected on your payslips";
    return "ESPP: Unknown - no payslip shows an employee stock purchase plan yet";
  })();
  // ROUND 55 displays: field-level resolution (workstream B), the
  // HSA distribution reconciliation (D), the SA tax forms (E) and
  // the expanded 401(k) fact set (F).
  const hsaRes = useMemo(() => hsaResolution(docs), [docs]);
  const hsaSnap = useMemo(() => hsaBalanceSnapshots(docs), [docs]);
  const hsaReconYears = useMemo(() => hsaReconciliation(docs, state.hsaReceiptsMatched ?? {}), [docs, state.hsaReceiptsMatched]);
  const saForms = useMemo(() => docs.filter((d) => d.docType === "hsa_1099_sa" || d.docType === "hsa_5498_sa"), [docs]);
  const k401Facts = useMemo(() => k401StatementFacts(docs), [docs]);
  const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Round 57: the HSA statement's period contribution is a MONTHLY
  // figure for the month the statement covers - it is labelled
  // with that month, never presented as a per-paycheck pace. The
  // per-payroll figure, when the statement's deposit detail proved
  // one, is a separate line on the card below.
  const hsaPeriodLine = (() => {
    const cp = hsaRes.fields.contributions_period;
    if (cp.value === null || !cp.source) return null;
    const asOf = cp.source.fields?.["statement_as_of"];
    return asOf
      ? `${monthYearOf(asOf)} contributions: ${money2(cp.value)} (from your HSA statement)`
      : `Statement period contributions: ${money2(cp.value)} (from your HSA statement)`;
  })();
  // Round 56 (defect 3): the confirm card's empty-read form. A
  // reading is in this state when the text that produced it was
  // empty (isEmptyRead) and no field filled - derived at render
  // time so a band re-read that rescues fields leaves the state
  // on its own. A merely UNCLASSIFIED read (real text, no type
  // matched) does not enter it and keeps the normal card.
  const extractionEmptyRead = !!(extraction && pendingText !== null && Object.keys(extraction.fields).length === 0 && isEmptyRead(pendingText));
  // Needs list = profile requests BEYOND the Ongoing center (owner,
  // 2026-11-08): a document type the Ongoing center already tracks
  // never appears in the needs list too - no asking twice.
  const ongoingTypes = new Set(CATS.map((c) => c.docType));
  const needsList = requests.filter((r) => !ongoingTypes.has(r.docType));
  const EVENT_LABEL: Record<EquityEvent["kind"], string> = { bonus: "Bonus", rsu_vest: "RSU vest", espp_purchase: "ESPP purchase" };
  const lastEvent = state.events.length ? [...state.events].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  const saveEvent = () => {
    const amount = Number(evAmount.replace(/[$,]/g, "")) || 0;
    update({ events: [...state.events, { id: `ev-${Date.now()}`, kind: evKind, date: evDate, amount, note: evNote.trim() }] });
    setShowEventForm(false);
    setEvAmount("");
    setEvNote("");
  };

  // One upload button per card (owner, 2026-11-08): the old trio
  // (file / photo / camera buttons side by side) was duplication.
  // The single Upload button opens this source chooser - the user
  // can bring any kind of file or take a photo, from the one button.
  //
  // ROUND 56 (device QA defect 2): the chooser is NATIVE-ONLY now.
  // Diagnosis from the owner's iPhone: on web, every entry behind
  // these buttons ends at the same DOM <input type="file"> click,
  // and iOS in a standalone web app answers ANY file input with the
  // one system sheet (Photo Library / Take Photo / Choose Files).
  // It ignores the capture attribute there (expo-image-picker's web
  // camera sets capture="camera" and still got the sheet), and the
  // accept attribute only filters inside a source - so no web
  // button could honestly promise "library" or "camera". On web
  // the single block button therefore starts the generic multi-file
  // pick directly: the system sheet IS the source choice, and each
  // picked item is routed by its content. On native the three
  // pickers are genuinely different controls (document picker,
  // photo library, camera), so the chooser stays - and says only
  // what each one does.
  const [chooserFor, setChooserFor] = useState<string | null>(null);
  const openUpload = (key: string, docType?: string) => {
    if (Platform.OS === "web") {
      void uploadFiles(docType);
    } else {
      setChooserFor(chooserFor === key ? null : key);
    }
  };
  const sourceChooser = (key: string, docType?: string) =>
    Platform.OS === "web" || chooserFor !== key ? null : (
      <View style={styles.reqActions}>
        <Pressable style={styles.button} onPress={() => { setChooserFor(null); uploadFiles(docType); }}>
          <Text style={styles.buttonText}>PDF or file</Text>
        </Pressable>
        <Pressable style={styles.buttonAlt} onPress={() => { setChooserFor(null); scanPhoto("upload", docType); }}>
          <Text style={styles.buttonText}>Photo from library</Text>
        </Pressable>
        <Pressable style={styles.buttonAlt} onPress={() => { setChooserFor(null); scanPhoto("camera", docType); }}>
          <Text style={styles.buttonText}>Take a photo</Text>
        </Pressable>
      </View>
    );

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Documents</Text>

      {assignChildId && (
        <View style={styles.assignBanner}>
          <Text style={styles.assignText}>
            Filling college savings for {state.family.find((m) => m.id === assignChildId)?.name || "your child"}: upload their 529 statement below (file, photo, or camera) and confirm - the saved balance goes onto their card, and the monthly contribution too if the statement shows one.
          </Text>
          <Pressable onPress={() => setAssignChildId(null)}><Text style={styles.remove}>Cancel assignment</Text></Pressable>
        </View>
      )}

      {state.reprocessNotes.length > 0 && (
        <View style={styles.assignBanner}>
          <Text style={styles.assignText}>HomeTower re-read your saved documents with its improved reader:</Text>
          {state.reprocessNotes.map((n, i) => (
            <Text key={i} style={styles.assignText}>- {n}</Text>
          ))}
          <Pressable onPress={() => update({ reprocessNotes: [] })}><Text style={styles.remove}>Dismiss</Text></Pressable>
        </View>
      )}

      {/* ROUND 62 (R62-5 + R62-7): developer diagnostics - the
          runtime invariants over canonical state and the "Why
          this number?" lineage for every material Home KPI. */}
      <View style={styles.assignBanner}>
        <Pressable onPress={() => setShowDiag(!showDiag)}>
          <Text style={styles.assignText}>
            Developer diagnostics: {invariantViolations(invariantResults)} invariant violation{invariantViolations(invariantResults) === 1 ? "" : "s"} - KPI lineage coverage {Math.round(lineageCoverage(lineageTraces) * 100)}% {showDiag ? "(hide)" : "(show)"}
          </Text>
        </Pressable>
        {showDiag && (
          <View>
            {invariantResults.map((r, i) => (
              <Text key={`inv-${i}`} style={styles.assignText}>{r.ok ? "OK" : "VIOLATION"} - {r.rule}: {r.detail}</Text>
            ))}
            {lineageTraces.map((t, i) => (
              <Text key={`lin-${i}`} style={styles.assignText}>
                Why this number? {t.kpi} = {t.displayed} - from {t.sources.join("; ") || "no document source"}{t.accounts.length ? ` - accounts: ${t.accounts.join(", ")}` : ""} - facts: {t.facts.map((f) => `${f.field} ${f.value ?? ""} (${f.docType}, as of ${f.asOf ?? "unknown"}, ref ${f.docRef})`).join("; ") || "none"}
              </Text>
            ))}
          </View>
        )}
      </View>


      <Text style={styles.section}>Upload any document</Text>
      <Text style={styles.note}>
        No need to say what it is: HomeTower reads it, identifies the type, and shows you its reading for approval
        before anything is saved. If you do pick a type below, HomeTower still verifies it against the content.
      </Text>
      <Pressable style={styles.button} onPress={() => openUpload("any")}>
        <Text style={styles.buttonText}>Upload - file, photo, or camera</Text>
      </Pressable>
      {sourceChooser("any")}
      {flowNote && <Text style={styles.note}>{flowNote}</Text>}
      <TextInput
        style={styles.pasteBox}
        multiline
        placeholder="...or paste any document text here and let HomeTower identify it"
        value={autoPaste}
        onChangeText={setAutoPaste}
      />
      <Pressable style={styles.buttonAlt} onPress={() => { if (!startCsvReading(autoPaste, "")) runExtraction(autoPaste); }}>
        <Text style={styles.buttonText}>Read and identify pasted text</Text>
      </Pressable>

      {intakeFailure && (
        <View style={styles.confirmCard} onLayout={(e) => { failureY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.section}>{intakeFailure.heading}</Text>
          <Text style={styles.line}>{intakeFailure.body}</Text>
          <Pressable onPress={() => setIntakeFailure(null)}>
            <Text style={styles.remove}>Dismiss</Text>
          </Pressable>
        </View>
      )}
      {extraction && (
        <View style={styles.confirmCard} onLayout={(e) => { confirmY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.section}>Confirm HomeTower's reading</Text>
          {intakeBatch && (
            <Text style={styles.batchLine}>{intakeBatch.noun} {intakeBatch.done} of {intakeBatch.total} - confirm this one and the next follows.</Text>
          )}
          {intakeBatch && extractionType === "payslip" && batchSaveRef.current && payslipKey(Object.fromEntries(Object.entries(extraction.fields).map(([k, v]) => [k, String(v)]))) !== "" && payslipKey(Object.fromEntries(Object.entries(extraction.fields).map(([k, v]) => [k, String(v)]))) === batchSaveRef.current.key && (
            <Text style={styles.line}>Same payslip as the previous screenshot ({String(extraction.fields["employee_name"] ?? "")}, period ending {String(extraction.fields["pay_period_end"] ?? "")}) - confirming merges its pages into ONE document.</Text>
          )}
          {extractionEmptyRead && (
            <View style={styles.mismatch}>
              <Text style={styles.line}>HomeTower could not read any text from this file.</Text>
              <Text style={styles.line}>
                Most likely it is a scanned document with no text layer, or an image HomeTower could not process - either way there was nothing in it to identify or fill in. This is a failed reading, not a document type.
              </Text>
              <Text style={styles.line}>
                What to do instead: upload a photo or screenshot of the document (HomeTower reads those with its image reader), or a PDF that has a text layer. You can also save this file as a register entry below - it records that the document arrived, and fills in no figures.
              </Text>
            </View>
          )}
          {detection && !extractionEmptyRead && detection.level !== "unknown" && (
            <Text style={styles.line}>
              This looks like a {detection.docType} ({detection.level} match) - signals: {detection.signals.join(", ")}.
            </Text>
          )}
          {detection && !extractionEmptyRead && detection.level === "unknown" && (
            <View style={styles.mismatch}>
              <Text style={styles.line}>
                HomeTower read the text in this file, but could not match it to a known document. That is a recognition-quality problem, not a problem with your document - the beginning of what was read is shown below so you can judge the reading yourself. Pick the type below if you know it, or paste the text instead in the paste box just above this card.
              </Text>
              {pendingText ? (
                <Text style={styles.note}>What HomeTower read: "{unmatchedExcerpt(pendingText)}"</Text>
              ) : null}
              <Pressable style={styles.button} onPress={() => setExtraction(null)}>
                <Text style={styles.buttonText}>Close this card and paste the text instead</Text>
              </Pressable>
            </View>
          )}
          {detection && !extractionEmptyRead && detection.level !== "unknown" && detection.docType !== extractionType && (
            <View style={styles.mismatch}>
              <Text style={styles.line}>
                Heads up: it will be saved as {extractionType}, but the content looks like a {detection.docType}.
              </Text>
              <Pressable style={styles.button} onPress={() => reextractAs(detection.docType)}>
                <Text style={styles.buttonText}>Save as {detection.docType} instead</Text>
              </Pressable>
            </View>
          )}
          {!extractionEmptyRead && (
            <Text style={styles.line}>Saving as: {extractionType} - Confidence: {extraction.confidence} - status if saved: {extraction.status}</Text>
          )}
          {pendingSpending && (extractionType === "bank_statement" || extractionType === "card_statement") && (
            <Text style={styles.line}>
              Spending read from this statement: {pendingSpending.months} month{pendingSpending.months === 1 ? "" : "s"}, {pendingSpending.transactions} outflows counted, about ${Math.round(pendingSpending.totalOutflowAnnual).toLocaleString("en-US")} a year. It becomes spending evidence on the Retirement Lifestyle page (in Plan) - it fills only categories you have not filled yourself.
            </Text>
          )}
          {extractionType === "payslip" && (() => {
            const missing: string[] = [];
            if (!(Number(extraction.fields["ytd_federal_withheld"]) > 0)) missing.push("federal withholding YTD");
            if (!(Number(extraction.fields["ytd_taxable_wages"]) > 0)) missing.push("taxable wages YTD");
            if (missing.length === 0) return null;
            return (
              <Text style={styles.note}>
                Heads up: this reading is missing {missing.join(" and ")} - HomeTower needs
                them for the Home forecast. You can save anyway (a clearer screenshot of
                that part of the slip, or the Workday PDF, fills them in later).
              </Text>
            );
          })()}
          {!extractionEmptyRead && (
            <>
              <Text style={styles.line}>Wrong type? Tap the right one - the fields are re-read:</Text>
              <View style={styles.chips}>
                {[...DOCUMENT_TYPES].map((t) => (
                  <Pressable key={t} style={[styles.chip, extractionType === t && styles.chipSelected]} onPress={() => reextractAs(t)}>
                    <Text style={extractionType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {Object.entries(extraction.fields).map(([k, v]) => (
            <Text key={k} style={styles.line}>{k}: {String(v)}</Text>
          ))}
          {extractionType === "401k_statement" && pending401kDetail && (pending401kDetail.pretaxBalance !== null || pending401kDetail.holdings.length > 0 || pending401kDetail.election) && (
            <>
              <Text style={styles.line}>Also read from this statement - saved with it, each figure with this statement as its source:</Text>
              {pending401kDetail.pretaxBalance !== null && <Text style={styles.line}>Balance mix: pre-tax {money2(pending401kDetail.pretaxBalance)}{pending401kDetail.matchBalance !== null ? ` - employer match ${money2(pending401kDetail.matchBalance)}` : ""}{pending401kDetail.rothConversionBalance !== null ? ` - Roth conversions ${money2(pending401kDetail.rothConversionBalance)}` : ""}{pending401kDetail.afterTaxBalance !== null ? ` - after-tax ${money2(pending401kDetail.afterTaxBalance)}` : ""}</Text>}
              {pending401kDetail.rothConversionBalance !== null && <Text style={styles.line}>Mega Backdoor Roth: the after-tax balance above and the Roth conversion balance form this picture - shown on the 401(k) card and in the retirement details.</Text>}
              {pending401kDetail.holdings.map((h) => (
                <Text key={h.label} style={styles.line}>Invested in: {h.label} - {money2(h.value)}</Text>
              ))}
              {pending401kDetail.election && <Text style={styles.line}>Future contributions: {pending401kDetail.election} (your current election)</Text>}
            </>
          )}
          {pendingSaForm && pendingSaForm.kind === extractionType && (
            <Text style={styles.line}>
              Tax year {pendingSaForm.taxYear ?? ""}{pendingSaForm.accountId ? ` - account ${pendingSaForm.accountId}` : ""}. This form is historical tax evidence: saving it changes no current balance anywhere. {extractionType === "hsa_1099_sa" ? "Its gross distribution feeds the HSA receipts reconciliation for its own year." : "Its contributions and fair market value are shown on the HSA card with their date."}
            </Text>
          )}
          {extractionType === "brokerage_statement" && pendingPlan && (
            <>
              <Text style={styles.line}>Stock plan account: {pendingPlan.ticker}{pendingPlan.company ? ` - ${pendingPlan.company}` : ""}</Text>
              {(() => {
                const vested = Number(extraction.fields["vested_balance"]);
                const unvested = Number(extraction.fields["unvested_balance"]);
                const total = Number(extraction.fields["ending_balance"]);
                if (Number.isFinite(vested) && Number.isFinite(unvested) && Number.isFinite(total) && Math.abs(vested + unvested - total) <= 1) {
                  return <Text style={styles.line}>Vested ${vested.toLocaleString("en-US")} + not yet vested ${unvested.toLocaleString("en-US")} = ${total.toLocaleString("en-US")} - the split ties to the total.</Text>;
                }
                return null;
              })()}
            </>
          )}
          {extractionType === "brokerage_statement" && pendingHoldings && pendingHoldings.positions.length > 0 && (
            <>
              <Text style={styles.line}>Positions read from this screenshot - check them before saving:</Text>
              {pendingHoldings.positions.map((p) => (
                <Text key={p.ticker} style={styles.line}>
                  {p.ticker} - {p.quantity} shares - paid ${p.pricePaid.toLocaleString("en-US")} - now ${p.lastPrice.toLocaleString("en-US")} - value ${positionValue(p).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </Text>
              ))}
              {(() => {
                const posSum = pendingHoldings.positions.reduce((a, p) => a + positionValue(p), 0);
                const cash = pendingHoldings.cash ?? (Number.isFinite(Number(extraction.fields["cash_balance"])) ? Number(extraction.fields["cash_balance"]) : null);
                const account = Number(extraction.fields["ending_balance"]);
                if (cash !== null && Number.isFinite(account) && account > 0) {
                  const total = posSum + cash;
                  return Math.abs(total - account) <= 1 ? (
                    <Text style={styles.line}>Check: positions ${posSum.toLocaleString("en-US", { maximumFractionDigits: 2 })} + cash ${cash.toLocaleString("en-US")} = ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })} - matches the account value on the screenshot.</Text>
                  ) : (
                    <Text style={styles.line}>Check: positions ${posSum.toLocaleString("en-US", { maximumFractionDigits: 2 })} + cash ${cash.toLocaleString("en-US")} = ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}, but the account value reads ${account.toLocaleString("en-US")} - a position may be cut off or misread; scroll the app and add another screenshot if one is missing.</Text>
                  );
                }
                return <Text style={styles.line}>Positions total ${posSum.toLocaleString("en-US", { maximumFractionDigits: 2 })} (cash not read from this screenshot).</Text>;
              })()}
            </>
          )}
          {extractionType === "529_statement" && eduChildren.length > 0 && (
            <>
              <Text style={styles.line}>Whose college savings is this? The balance (and monthly contribution, if shown) fills that child's funding:</Text>
              <View style={styles.chips}>
                {eduChildren.map((c) => (
                  <Pressable key={c.id} style={[styles.chip, assignChildId === c.id && styles.chipSelected]} onPress={() => setAssignChildId(assignChildId === c.id ? null : c.id)}>
                    <Text style={assignChildId === c.id ? styles.chipTextSelected : styles.chipText}>{c.name || "Child"}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {extractionType === "ssa_statement" && adults.length > 0 && (
            <>
              <Text style={styles.line}>Whose statement is this? Its estimated monthly benefit counts as that adult's Social Security:</Text>
              <View style={styles.chips}>
                {adults.map((m) => {
                  const picked = (assignMemberId ?? (adults.length === 1 ? adults[0].id : null)) === m.id;
                  return (
                    <Pressable key={m.id} style={[styles.chip, picked && styles.chipSelected]} onPress={() => setAssignMemberId(m.id)}>
                      <Text style={picked ? styles.chipTextSelected : styles.chipText}>{m.name || (m.role === "self" ? "You" : "Spouse")}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {extractionType === "401k_statement" && adults.length > 0 && (
            <>
              <Text style={styles.line}>Whose statement is this? Its ending balance becomes that adult's 401(k) starting balance in the retirement outlook:</Text>
              <View style={styles.chips}>
                {adults.map((m) => {
                  const picked = (assign401kMemberId ?? (adults.length === 1 ? adults[0].id : null)) === m.id;
                  return (
                    <Pressable key={m.id} style={[styles.chip, picked && styles.chipSelected]} onPress={() => setAssign401kMemberId(m.id)}>
                      <Text style={picked ? styles.chipTextSelected : styles.chipText}>{m.name || (m.role === "self" ? "You" : "Spouse")}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {Object.keys(extraction.fields).length === 0 && !extractionEmptyRead && (
            <Text style={styles.line}>No known fields matched this document type. You can still save it as a register entry.</Text>
          )}
          {saveBlock && (
            <View style={styles.mismatch}>
              <Text style={styles.line}>Not saved - HomeTower needs a second look at this one:</Text>
              {saveBlock.map((r, i) => (
                <Text key={i} style={styles.line}>{r}</Text>
              ))}
              <Text style={styles.line}>If the document really is what it claims to be, check the figures above against it and try the upload again; otherwise discard this reading.</Text>
            </View>
          )}
          <Pressable style={styles.button} onPress={confirmExtraction}>
            <Text style={styles.buttonText}>
              {intakeBatch
                ? intakeBatch.queue.length > 0
                  ? `Confirm and save (${intakeBatch.done} of ${intakeBatch.total}) - next follows`
                  : `Confirm and save (${intakeBatch.total} of ${intakeBatch.total}) - last one`
                : `Confirm and save as ${extractionType}`}
            </Text>
          </Pressable>
          <Pressable onPress={() => { setExtraction(null); setDetection(null); setPendingText(null); setPendingHoldings(null); setPendingPlan(null); setPendingSpending(null); setPending401kDetail(null); setPendingSaForm(null); setSaveBlock(null); advanceIntakeBatch(); }}>
            <Text style={styles.remove}>{intakeBatch ? `Discard (${intakeBatch.done} of ${intakeBatch.total})` : "Discard"}</Text>
          </Pressable>
        </View>
      )}
      {fanOut && !extraction && (
        <View style={styles.confirmCard}>
          <Text style={styles.section}>Confirm HomeTower's reading - {fanOut.sections.length} accounts in one document</Text>
          {intakeBatch && (
            <Text style={styles.batchLine}>{intakeBatch.noun} {intakeBatch.done} of {intakeBatch.total} - one document, {fanOut.sections.length} account readings. Confirm and the next follows.</Text>
          )}
          {fanOut.portfolioTotal !== null && (
            <Text style={styles.line}>The document's combined portfolio total is {money2(fanOut.portfolioTotal)} - that total belongs to all the accounts together and is never saved as one account's balance.</Text>
          )}
          {fanOut.sections.map((fs, i) => (
            <View key={i} style={styles.fanSection}>
              <Text style={styles.line}>
                {fs.section.kind === "529" ? `529 account ${fs.section.accountId ?? ""} - ${fs.section.personName ?? "beneficiary not printed"}` : `Health Savings Account ${fs.section.accountId ?? ""} - ${fs.section.personName ?? ""}`}
                {fanOut.period ? ` - statement period ending ${dateLabel(fanOut.period.endIso)}` : ""}
              </Text>
              {fs.section.kind === "hsa"
                ? hsaFanLines(fs.fields, fanOut.period).map((l) => (
                  <Text key={l.key} style={styles.line}>{l.text}</Text>
                ))
                : Object.entries(fs.fields).map(([k, v]) => (
                  <Text key={k} style={styles.line}>{k}: {String(v)}</Text>
                ))}
              {fs.section.kind === "529" && eduChildren.length > 0 && (
                <>
                  <Text style={styles.line}>Whose 529 is this? The balance and monthly pace fill that child's college funding:</Text>
                  <View style={styles.chips}>
                    {eduChildren.map((c) => (
                      <Pressable key={c.id} style={[styles.chip, fs.childId === c.id && styles.chipSelected]} onPress={() => setFanOut((f) => (f ? { ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, childId: s.childId === c.id ? null : c.id } : s)) } : f))}>
                        <Text style={fs.childId === c.id ? styles.chipTextSelected : styles.chipText}>{c.name || "Child"}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              {fs.section.kind === "hsa" && adults.length > 0 && (
                <>
                  <Text style={styles.line}>Whose HSA is this?</Text>
                  <View style={styles.chips}>
                    {adults.map((m) => (
                      <Pressable key={m.id} style={[styles.chip, fs.memberId === m.id && styles.chipSelected]} onPress={() => setFanOut((f) => (f ? { ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, memberId: s.memberId === m.id ? null : m.id } : s)) } : f))}>
                        <Text style={fs.memberId === m.id ? styles.chipTextSelected : styles.chipText}>{m.name || (m.role === "self" ? "You" : "Spouse")}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          ))}
          <Pressable style={styles.button} onPress={confirmFanOut}>
            <Text style={styles.buttonText}>Confirm and save {fanOut.sections.length} account readings</Text>
          </Pressable>
          <Pressable onPress={() => { setFanOut(null); setPendingText(null); advanceIntakeBatch(); }}>
            <Text style={styles.remove}>{intakeBatch ? `Discard (${intakeBatch.done} of ${intakeBatch.total})` : "Discard"}</Text>
          </Pressable>
        </View>
      )}
      {ocrNote && <Text style={styles.note}>{ocrNote}</Text>}
      <Pressable onPress={() => setShowManual((s) => !s)}>
        <Text style={styles.manualLink}>No text handy? Register a document manually (today, no extraction)</Text>
      </Pressable>
      {showManual && (
        <View style={styles.shortcutBox}>
          <Text style={styles.line}>Pick the type, then register it - it counts as received today, with no reading.</Text>
          <View style={styles.chips}>
            {[...DOCUMENT_TYPES].map((t) => (
              <Pressable key={t} style={[styles.chip, selectedType === t && styles.chipSelected]} onPress={() => setSelectedType(t)}>
                <Text style={selectedType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.button} onPress={addManual}>
            <Text style={styles.buttonText}>Register {selectedType} manually</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.section}>Ongoing center</Text>
      <Text style={styles.note}>
        Everything that repeats - payslips, statements, events. Sorted by urgency: what needs you first is on top. Upload straight from each row.
      </Text>
      {[...CATS]
        .map((c) => ({ c, info: catInfo(c) }))
        .sort((a, b) => a.info.rank - b.info.rank)
        .map(({ c, info }) => {
          // ROUND 59 (TRACE C): an unexplained HSA reconciliation
          // delta overrides the freshness chip - the card must not
          // say UP TO DATE while its two sources disagree.
          const chip = c.key === "hsa" && hsaRecon.delta !== null && !hsaRecon.explained
            ? { t: `NEEDS ATTENTION - $${Math.abs(hsaRecon.delta).toLocaleString("en-US")} UNRECONCILED`, bg: "#FDE3DF", fg: "#A02C1D" }
            : chipFor(info.status);
          // 401(k) partial truth (owner, 2026-11-08): with no
          // statement yet, the card shows what payslips already
          // prove - this year's contributions - instead of a flat
          // "no document yet". The moment a statement exists it is
          // the source of record and this line disappears; the two
          // sources are never added together (payslip401kTotals).
          const k401Line = c.docType === "401k_statement" && !info.latest
            ? (() => {
                const k = payslip401kTotals(docs, today);
                return k
                  ? `From payslips: $${k.total.toLocaleString("en-US", { maximumFractionDigits: 0 })} contributed in ${k.year} (${k.earners} earner${k.earners === 1 ? "" : "s"}, through ${isoToUs(k.through)}) · Balance still needed - statement expected ${c.cadence}`
                  : null;
              })()
            : null;
          return (
            <View key={c.key} style={styles.catCard}>
              <View style={styles.catHead}>
                <Text style={styles.catName}>{c.icon} {c.name}</Text>
                <View style={[styles.statusChip, { backgroundColor: chip.bg }]}>
                  <Text style={[styles.statusChipText, { color: chip.fg }]}>{chip.t}</Text>
                </View>
              </View>
              <Text style={styles.line}>
                {info.latest
                  ? `Last: ${info.latest.capturedOn ? isoToUs(info.latest.capturedOn) : "date unknown"} · Expected ${c.cadence}${info.overdue > 0 ? ` · ${info.overdue} days overdue` : ""}`
                  : k401Line ?? `No document yet · Expected ${c.cadence}`}
                {c.extra ? `\n${c.extra}` : ""}
              </Text>
              {c.key === "401k" && <Text style={styles.line}>{matchHouseholdLine}</Text>}
              {c.key === "401k" && k401Facts && (
                <>
                  {k401Facts.balance !== null && <Text style={styles.line}>401(k) balance: {money2(k401Facts.balance)} - 401(k) statement, period ending {dateLabel(k401Facts.statementAsOf ?? k401Facts.capturedOn ?? "")}</Text>}
                  {(k401Facts.pretaxRothYtd !== null || k401Facts.afterTaxYtd !== null || k401Facts.matchYtd !== null || k401Facts.total415Ytd !== null) && (
                    <Text style={styles.line}>Contributions this year, confirmed by the statement:{k401Facts.pretaxRothYtd !== null ? ` pre-tax/Roth ${money2(k401Facts.pretaxRothYtd)}` : ""}{k401Facts.afterTaxYtd !== null ? ` - after-tax ${money2(k401Facts.afterTaxYtd)}` : ""}{k401Facts.matchYtd !== null ? ` - employer match ${money2(k401Facts.matchYtd)}` : ""}{k401Facts.total415Ytd !== null ? ` - total ${money2(k401Facts.total415Ytd)}` : ""}. The monthly pace still comes from the freshest regular payslip - the statement confirms the year's totals.</Text>
                  )}
                  {(k401Facts.pretaxBalance !== null || k401Facts.matchBalance !== null || k401Facts.rothConversionBalance !== null || k401Facts.afterTaxBalance !== null) && (
                    <Text style={styles.line}>Balance mix: {k401Facts.pretaxBalance !== null ? `pre-tax ${money2(k401Facts.pretaxBalance)}` : ""}{k401Facts.matchBalance !== null ? ` - employer match ${money2(k401Facts.matchBalance)}` : ""}{k401Facts.rothConversionBalance !== null ? ` - Roth conversions ${money2(k401Facts.rothConversionBalance)}` : ""}{k401Facts.afterTaxBalance !== null ? ` - after-tax ${money2(k401Facts.afterTaxBalance)}` : ""} (401(k) statement, {dateLabel(k401Facts.statementAsOf ?? k401Facts.capturedOn ?? "")})</Text>
                  )}
                  {(k401Facts.afterTaxYtd !== null || k401Facts.rothConversionBalance !== null || k401Facts.afterTaxBalance !== null) && (
                    <Text style={styles.line}>Mega Backdoor Roth: {k401Facts.afterTaxYtd !== null ? `after-tax contributions ${money2(k401Facts.afterTaxYtd)} this year` : ""}{k401Facts.rothConversionBalance !== null ? ` - Roth in-plan conversion balance ${money2(k401Facts.rothConversionBalance)}` : ""}{k401Facts.afterTaxBalance !== null ? ` - after-tax balance still unconverted ${money2(k401Facts.afterTaxBalance)}${k401Facts.afterTaxBalance === 0 ? " (the statement prints $0.00 - a confirmed zero)" : ""}` : ""}. Source: 401(k) statement, {dateLabel(k401Facts.statementAsOf ?? k401Facts.capturedOn ?? "")}.</Text>
                  )}
                  {k401Facts.holdings.map((h) => (
                    <Text key={h.label} style={styles.line}>Invested in: {h.label} - {money2(h.value)} (401(k) statement)</Text>
                  ))}
                  {k401Facts.election && <Text style={styles.line}>Future contributions: {k401Facts.election} (current election, per the statement)</Text>}
                </>
              )}
              {c.key === "hsa" && hsaLines.map((l, i) => <Text key={i} style={styles.line}>{l}</Text>)}
              {c.key === "hsa" && hsaSnap.current.value !== null && hsaSnap.current.source && (
                <Text style={styles.line}>Current balance: {money2(hsaSnap.current.value)} - {sourceLabelFor(hsaSnap.current.source)}</Text>
              )}
              {c.key === "hsa" && hsaSnap.statementSnapshot && (
                <Text style={styles.line}>{monthNameOf(hsaSnap.statementSnapshot.asOf)} statement snapshot: {money2(hsaSnap.statementSnapshot.value)} - {dateLabel(hsaSnap.statementSnapshot.asOf)}</Text>
              )}
              {c.key === "hsa" && hsaPeriodLine && (
                <Text style={styles.line}>{hsaPeriodLine}</Text>
              )}
              {c.key === "hsa" && hsaRes.fields.per_payroll_contribution.value !== null && (
                <Text style={styles.line}>Per-payroll contribution: {money2(hsaRes.fields.per_payroll_contribution.value)} (from the statement's deposit detail)</Text>
              )}
              {c.key === "hsa" && hsaRes.conflicts.map((cf) => (
                <Text key={cf.field} style={styles.line}>Two readings of the HSA {cf.field.replace(/_/g, " ")} disagree for the same date ({cf.entries.map((e) => money2(e.value)).join(" vs ")}) - HomeTower shows the first and flags it here rather than choosing silently.</Text>
              ))}
              {c.key === "hsa" && hsaReconYears.map((y) => (
                <View key={y.year}>
                  <Text style={styles.line}>{y.year} HSA distributions: {money2(y.distributions)} ({y.source === "1099-SA" ? "per Form 1099-SA" : "from statements"}) - receipts matched {money2(y.matched)} - still unverified {money2(y.unverified)}. Unverified is not the same as taxable - this is an evidence tracker.</Text>
                  <View style={styles.reqActions}>
                    <TextInput
                      style={[styles.pasteBox, { flex: 1, minHeight: 44 }]}
                      keyboardType="numeric"
                      placeholder="Receipts matched so far ($)"
                      value={receiptInputs[String(y.year)] ?? ""}
                      onChangeText={(t) => setReceiptInputs({ ...receiptInputs, [String(y.year)]: t })}
                    />
                    <Pressable style={styles.buttonAlt} onPress={() => {
                      const amt = Number((receiptInputs[String(y.year)] ?? "").replace(/[^0-9.]/g, ""));
                      if (Number.isFinite(amt) && amt >= 0) update({ hsaReceiptsMatched: { ...(state.hsaReceiptsMatched ?? {}), [String(y.year)]: amt } });
                    }}>
                      <Text style={styles.buttonText}>Save matched</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {c.key === "hsa" && saForms.map((d, i) => (
                <Text key={i} style={styles.line}>
                  {d.docType === "hsa_1099_sa"
                    ? `Form 1099-SA (${d.fields?.["tax_year"] ?? ""}): gross distribution ${money2(Number(d.fields?.["box_1_gross_distribution"] ?? 0))} - tax evidence for that year; it feeds that year's receipts reconciliation above and changes no balance.`
                    : `Form 5498-SA (${d.fields?.["tax_year"] ?? ""}): contributions ${money2(Number(d.fields?.["box_2_contributions"] ?? 0))}, fair market value ${money2(Number(d.fields?.["box_5_fair_market_value"] ?? 0))} at year end - historical evidence shown with its date; it changes no current balance.`}
                </Text>
              ))}
              {c.key === "529" && <Text style={styles.line}>{edu529Line}</Text>}
              {c.key === "529" && eduChildren.map((child) => {
                const r = eduResolutionFor(docs, child.id);
                const bal = r.fields.ending_balance;
                if (bal.value === null || !bal.source) return null;
                return (
                  <Text key={child.id} style={styles.line}>
                    {child.name || "Child"}: {money2(bal.value)} - {sourceLabelFor(bal.source)}
                    {typeof r.fields.contributions_ytd.value === "number" ? ` - contributed ${money2(r.fields.contributions_ytd.value)} this year` : ""}
                    {typeof r.fields.distributions_ytd.value === "number" && r.fields.distributions_ytd.value > 0 ? ` - distributions ${money2(r.fields.distributions_ytd.value)} this year (reconciliation on the Tasks page)` : ""}
                  </Text>
                );
              })}
              {c.key === "529" && eduChildren.flatMap((child) => eduReconYearsFor(docs, child, state.eduVerifiedExpenses ?? {}).map((y) => {
                const vKey = eduVerifiedKey(child.id, y.year);
                return (
                  <View key={vKey}>
                    <Text style={styles.line}>{y.year} {child.name || "Child"} 529 distributions: {money2(y.distributions)} (from statements) - education expenses verified {money2(y.verified)} - still unverified {money2(y.unverified)}. Unverified does not mean non-qualified - this is an evidence tracker.</Text>
                    <View style={styles.reqActions}>
                      <TextInput
                        style={[styles.pasteBox, { flex: 1, minHeight: 44 }]}
                        keyboardType="numeric"
                        placeholder="Education expenses verified so far ($)"
                        value={eduInputs[vKey] ?? ""}
                        onChangeText={(t) => setEduInputs({ ...eduInputs, [vKey]: t })}
                      />
                      <Pressable style={styles.buttonAlt} onPress={() => {
                        const amt = Number((eduInputs[vKey] ?? "").replace(/[^0-9.]/g, ""));
                        if (Number.isFinite(amt) && amt >= 0) update({ eduVerifiedExpenses: { ...(state.eduVerifiedExpenses ?? {}), [vKey]: amt } });
                      }}>
                        <Text style={styles.buttonText}>Save verified</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }))}
              {c.key === "529" && eduChildren.flatMap((child) => eduResolutionFor(docs, child.id).conflicts.map((cf) => (
                <Text key={`${child.id}-${cf.field}`} style={styles.line}>Two readings of {child.name || "your child"}'s {cf.field.replace(/_/g, " ")} disagree for the same date - flagged here rather than chosen silently.</Text>
              )))}
              <View style={styles.catActions}>
                <Pressable style={[styles.button, { flex: 1 }]} onPress={() => openUpload(c.key, c.docType)}>
                  <Text style={styles.buttonText}>Upload {c.key === "payslip" ? "a payslip" : "a statement"}</Text>
                </Pressable>
                {c.key === "payslip" ? (
                  <Pressable style={[styles.buttonAlt, { flex: 0.7 }]} onPress={() => setShowShortcut((s) => !s)}>
                    <Text style={styles.buttonText}>No change</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[styles.buttonAlt, { flex: 0.7 }]} onPress={() => setExpandedCat(expandedCat === c.key ? null : c.key)}>
                    <Text style={styles.buttonText}>History ({info.ofType.length})</Text>
                  </Pressable>
                )}
              </View>
              {sourceChooser(c.key, c.docType)}
              {c.key === "payslip" && showShortcut && (
                hasPayslip ? (
                  <View style={styles.shortcutBox}>
                    <Text style={styles.line}>Instead of uploading a new payslip every cycle: did anything change since the last one?</Text>
                    {state.payrollCheck.lastConfirmedOn && (
                      <Text style={styles.line}>
                        Last confirmed unchanged: {isoToUs(state.payrollCheck.lastConfirmedOn)} (provisional cycle {state.payrollCheck.consecutive} of 3 - the 3rd needs the document)
                      </Text>
                    )}
                    {([
                      ["gross", "Did gross pay change?"],
                      ["net", "Did the net deposit change?"],
                      ["benefits", "Did any benefit election change?"],
                    ] as const).map(([key, label]) => (
                      <View key={key}>
                        <Text style={styles.line}>{label}</Text>
                        <View style={styles.chips}>
                          {([["no", "No change"], ["yes", "Changed"], ["unsure", "Not sure"]] as const).map(([val, lab]) => (
                            <Pressable
                              key={val}
                              style={[styles.chip, payAnswers[key] === val && styles.chipSelected]}
                              onPress={() => setPayAnswers((a) => ({ ...a, [key]: val }))}
                            >
                              <Text style={payAnswers[key] === val ? styles.chipTextSelected : styles.chipText}>{lab}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ))}
                    <Pressable style={styles.button} onPress={confirmPayrollCycle}>
                      <Text style={styles.buttonText}>Confirm this cycle</Text>
                    </Pressable>
                    {payNote && <Text style={styles.note}>{payNote}</Text>}
                  </View>
                ) : (
                  <Text style={styles.note}>Upload one payslip first - then this shortcut unlocks for the cycles after it.</Text>
                )
              )}
              {expandedCat === c.key && (
                <View style={styles.shortcutBox}>
                  {info.ofType.length === 0 && <Text style={styles.line}>No documents of this type yet.</Text>}
                  {info.ofType.map((d, i) => (
                    <Text key={i} style={styles.line}>
                      {d.capturedOn ? isoToUs(d.capturedOn) : "date unknown"} - {d.status} - confidence {d.confidence}{d.holdings && d.holdings.length > 0 ? ` - ${d.holdings.length} positions (${d.holdings.map((h) => h.ticker).join(", ")})` : ""}{d.fields?.["account_ticker"] ? ` - ${d.fields["account_ticker"]} stock plan` : ""}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}

      <View style={styles.catCard}>
        <View style={styles.catHead}>
          <Text style={styles.catName}>🎁 Bonuses & RSU / ESPP</Text>
          <View style={[styles.statusChip, { backgroundColor: "#D9F0EC" }]}>
            <Text style={[styles.statusChipText, { color: "#0B5A52" }]}>EVENTS</Text>
          </View>
        </View>
        <Text style={styles.line}>
          {lastEvent
            ? `Last event: ${EVENT_LABEL[lastEvent.kind]} - ${isoToUs(lastEvent.date)}${lastEvent.amount > 0 ? ` - $${lastEvent.amount.toLocaleString()}` : ""}${lastEvent.note ? ` - ${lastEvent.note}` : ""} · ${state.events.length} event${state.events.length === 1 ? "" : "s"} recorded`
            : "No events recorded yet. Bonuses also appear inside payslips - events keep their own timeline."}
        </Text>
        <Text style={styles.line}>{esppLine}</Text>
        <View style={styles.catActions}>
          <Pressable style={[styles.button, { flex: 1 }]} onPress={() => setShowEventForm((s) => !s)}>
            <Text style={styles.buttonText}>Add an event</Text>
          </Pressable>
          <Pressable style={[styles.buttonAlt, { flex: 0.7 }]} onPress={() => uploadFiles()}>
            <Text style={styles.buttonText}>Upload plan doc</Text>
          </Pressable>
        </View>
        {showEventForm && (
          <View style={styles.shortcutBox}>
            <View style={styles.chips}>
              {(Object.keys(EVENT_LABEL) as EquityEvent["kind"][]).map((k) => (
                <Pressable key={k} style={[styles.chip, evKind === k && styles.chipSelected]} onPress={() => setEvKind(k)}>
                  <Text style={evKind === k ? styles.chipTextSelected : styles.chipText}>{EVENT_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.line}>Date</Text>
            <DateField value={evDate} onChange={setEvDate} />
            <Text style={styles.line}>Amount ($)</Text>
            <TextField value={evAmount} onChange={setEvAmount} keyboardType="numeric" placeholder="e.g. 12500" />
            <Text style={styles.line}>Note (optional)</Text>
            <TextField value={evNote} onChange={setEvNote} placeholder="e.g. Q4 bonus, Intel" />
            <Pressable style={styles.button} onPress={saveEvent}>
              <Text style={styles.buttonText}>Save event</Text>
            </Pressable>
            {state.events.length > 0 && (
              <>
                <Text style={styles.line}>Recorded:</Text>
                {[...state.events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((e) => (
                  <View key={e.id} style={styles.catHead}>
                    <Text style={styles.line}>{EVENT_LABEL[e.kind]} - {isoToUs(e.date)}{e.amount > 0 ? ` - $${e.amount.toLocaleString()}` : ""}</Text>
                    <Pressable onPress={() => update({ events: state.events.filter((x) => x.id !== e.id) })}>
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </View>

      <Text style={styles.section}>What your household needs</Text>
      <Text style={styles.note}>
        Additional, one-time needs from your profile - the recurring documents live in the Ongoing center above,
        so HomeTower never asks for the same document twice. Tap an item to upload it right there.
      </Text>
      {needsList.map((r) => {
        const b = reqBadge(r.status);
        const open = expandedReq === r.key;
        return (
          <View key={r.key} style={styles.reqCard}>
            <Pressable
              style={styles.reqRow}
              onPress={() => { setSelectedType(r.docType); setExpandedReq(open ? null : r.key); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.docType}>{r.label}</Text>
                <Text style={styles.line}>{r.detail}</Text>
              </View>
              <Text style={{ color: b.c, fontWeight: "700", fontSize: 14 }}>{b.t}</Text>
            </Pressable>
            {open && r.key === "calibration_outcome" && (
              <View style={styles.reqActions}>
                <Text style={styles.line}>This one is not a document - it is the number the IRS and the state actually confirmed. Record it once in the Intake tab and the confidence score uses it as the calibration anchor.</Text>
                <Pressable style={styles.button} onPress={() => navigation.navigate("Intake")}>
                  <Text style={styles.buttonText}>Open Intake to record the outcome</Text>
                </Pressable>
              </View>
            )}
            {open && r.key !== "calibration_outcome" && (
              <View style={styles.reqActions}>
                <Pressable style={styles.button} onPress={() => openUpload(`req-${r.key}`, r.docType)}>
                  <Text style={styles.buttonText}>Upload this document</Text>
                </Pressable>
                {sourceChooser(`req-${r.key}`, r.docType)}
              </View>
            )}
          </View>
        );
      })}

      {needsList.length === 0 && <Text style={styles.line}>Nothing else is needed right now - the Ongoing center above covers the rest.</Text>}

      <Text style={styles.section}>History</Text>
      <Text style={styles.note}>
        Everything your household has provided. Freshness is computed per document type, and each document
        counts toward the prediction confidence shown on Home.
      </Text>
      {docs.length === 0 && <Text style={styles.line}>No documents yet. Upload the first one at the top of this page.</Text>}
      {docs.map((d, i) => {
        const f = byKey.get(i);
        return (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.docType}>{d.docType}</Text>
              <Text style={styles.line}>Captured: {d.capturedOn ?? "unknown"} - status: {d.status}</Text>
              {f && <Text style={[styles.line, { color: BADGE[f.status] }]}>{f.status.toUpperCase()} - {f.message}</Text>}
              {indicators[i] && <Text style={[styles.line, { color: countsColor(indicators[i].counts), fontWeight: "600" }]}>{countsLabel(indicators[i].counts)} toward prediction confidence</Text>}
            </View>
            <Pressable onPress={() => removeDoc(i)}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 10 },
  title: { fontSize: 25, fontWeight: "800", color: NAVY },
  note: { fontSize: 14.5, color: "#5A6B7C", lineHeight: 21 },
  section: { fontSize: 19, fontWeight: "800", color: NAVY, marginTop: 10 },
  line: { fontSize: 15.5, color: "#22303C", lineHeight: 22 },
  row: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  reqCard: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, gap: 10 },
  reqRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  reqActions: { gap: 8 },
  docType: { fontSize: 15, fontWeight: "700", color: NAVY },
  remove: { color: "#C5221F", fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: TEAL, paddingHorizontal: 10, paddingVertical: 5 },
  chipSelected: { backgroundColor: TEAL },
  chipText: { color: TEAL, fontSize: 12, fontWeight: "600" },
  chipTextSelected: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  button: { backgroundColor: TEAL, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonAlt: { backgroundColor: NAVY, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  pasteBox: { backgroundColor: "#FFFFFF", borderRadius: 8, padding: 12, minHeight: 90, textAlignVertical: "top", fontSize: 13 },
  confirmCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 6, borderWidth: 1, borderColor: TEAL },
  fanSection: { borderTopWidth: 1, borderTopColor: "#D8E2E8", paddingTop: 8, gap: 4 },
  batchLine: { fontSize: 16.5, fontWeight: "700", color: "#0f766e", marginBottom: 6 },
  mismatch: { backgroundColor: "#FEF7E0", borderRadius: 10, padding: 10, gap: 8 },
  manualLink: { color: TEAL, fontSize: 13, fontWeight: "600", marginTop: 6 },
  catCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 13, gap: 8, borderWidth: 1, borderColor: "#D7E0E8" },
  catHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  catName: { fontSize: 17.5, fontWeight: "700", color: NAVY },
  catActions: { flexDirection: "row", gap: 8 },
  statusChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusChipText: { fontSize: 12, fontWeight: "700" },
  shortcutBox: { gap: 8, borderTopWidth: 1, borderTopColor: "#E3EAF0", paddingTop: 10 },
  assignBanner: { backgroundColor: "#E6F4F6", borderRadius: 12, padding: 12, gap: 6, borderWidth: 1, borderColor: "#0E7C86" },
  assignText: { fontSize: 15, color: "#0B2A4A", lineHeight: 21 },
  buttonGhost: { backgroundColor: "#E8EEF4", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  buttonGhostText: { color: NAVY, fontWeight: "700", fontSize: 14.5 },
});
