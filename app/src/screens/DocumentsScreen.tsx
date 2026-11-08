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
import { pickImageUri, pickImageUris, recognizeImageFile, recognizeOnDevice, takePhotoUri, textToRawFields } from "../ocr.ts";
import type { RawField } from "../../engine/extract.ts";
import { parseHoldings, parsePlanAccount, positionValue, type HoldingsParse, type PlanAccount } from "../holdings.ts";
import { parsePayslipRows } from "../payslipRows.ts";
import { pickFile, pickImageFiles } from "../filePick";
import { extractPdfText, extractPdfTextFromBuffer } from "../pdfText";
import { buildProfileExtras, todayIso, useHousehold } from "../store.tsx";
import { NAVY, TEAL } from "./HomeScreen.tsx";

const BADGE: Record<string, string> = { fresh: "#1E8E3E", aging: "#E37400", stale: "#C5221F", unknown: "#5A6B7C" };

export default function DocumentsScreen() {
  const { state, update, updateIntake } = useHousehold();
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const confirmY = useRef(0);
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
  const [pasteText, setPasteText] = useState("");
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [flowNote, setFlowNote] = useState<string | null>(null);
  // 529 assignment (owner QA round 19): a statement can fill a specific
  // child's college funding - picked from the My House child card (via
  // the store intent) or in the confirm card below.
  const [assignChildId, setAssignChildId] = useState<string | null>(null);
  const eduChildren = state.family.filter((m) => m.role === "child");
  useEffect(() => {
    if (state.eduAssignChildId) {
      setAssignChildId(state.eduAssignChildId);
      setSelectedType("529_statement");
      update({ eduAssignChildId: null });
    }
  }, [state.eduAssignChildId]);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [extractionType, setExtractionType] = useState("payslip");
  const [detection, setDetection] = useState<Classification | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [pendingColumns, setPendingColumns] = useState<RawField[][] | null>(null);
  const [pendingHoldings, setPendingHoldings] = useState<HoldingsParse | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanAccount | null>(null);
  // Multi-photo batch: the user picks several screenshots at once;
  // each is still read and confirmed one at a time, the queue just
  // walks itself after every confirm/discard.
  type PhotoItem = { uri: string } | { file: File };
  const [photoBatch, setPhotoBatch] = useState<{ queue: PhotoItem[]; namedType?: string; total: number; done: number } | null>(null);
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
  const runExtraction = (text: string, namedType?: string, pages?: string[], columnByPage?: RawField[][]) => {
    try {
      const textRaw = textToRawFields(text);
      if (!textRaw.length) {
        setOcrNote("No label-value pairs found in that text. Check the text and try again.");
        setExtraction(null);
        return;
      }
      const detected = classifyDocument(textRaw, text);
      const useType = namedType ?? detected.docType;
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
          const consumed = new Set(slip.consumedLines);
          const restText = text.split(/\r?\n/).filter((_, i) => !consumed.has(i)).join("\n");
          raw = [...slip.fields, ...textToRawFields(restText), ...colFlat];
        }
      }
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
      setExtraction(result);
      setExtractionType(useType);
      setOcrNote(null);
    } catch (e) {
      setOcrNote(e instanceof Error ? e.message : String(e));
      setExtraction(null);
    }
  };

  const reextractAs = (docType: string) => {
    if (pendingText === null) return;
    try {
      const colFlat = pendingColumns ? pendingColumns.flat() : [];
      let raw = [...textToRawFields(pendingText), ...colFlat];
      if (docType === "payslip") {
        const slip = parsePayslipRows(pendingText);
        if (slip.fields.length > 0) {
          const consumed = new Set(slip.consumedLines);
          const restText = pendingText.split(/\r?\n/).filter((_, i) => !consumed.has(i)).join("\n");
          raw = [...slip.fields, ...textToRawFields(restText), ...colFlat];
        }
      }
      setExtraction(extractFields(raw, docType));
      setExtractionType(docType);
    } catch (e) {
      setOcrNote(e instanceof Error ? e.message : String(e));
    }
  };

  const processPhotoItem = async (item: PhotoItem, namedType?: string, batchActive = false, batchLabel?: string) => {
    const outcome = "file" in item
      ? await recognizeImageFile(item.file, batchLabel ? (pct) => setOcrNote(`${batchLabel} - reading ${pct}%`) : undefined)
      : await recognizeOnDevice(item.uri);
    if (outcome.error) {
      setOcrNote(`OCR stage ${outcome.stage}: ${outcome.error}${batchActive ? " The rest of the batch was not read - pick the remaining screenshots again." : ""}`);
      setPhotoBatch(null);
      return;
    }
    runExtraction(outcome.text, namedType);
  };

  const advanceBatch = () => {
    if (!photoBatch || photoBatch.queue.length === 0) { setPhotoBatch(null); return; }
    const [next, ...rest] = photoBatch.queue;
    const nb = { queue: rest, namedType: photoBatch.namedType, total: photoBatch.total, done: photoBatch.done + 1 };
    setPhotoBatch(nb);
    void processPhotoItem(next, nb.namedType, true, `Screenshot ${nb.done} of ${nb.total}`);
  };

  const startPhotoBatch = async (items: PhotoItem[], namedType?: string) => {
    if (items.length === 1) {
      setPhotoBatch(null);
      await processPhotoItem(items[0], namedType);
      return;
    }
    setPhotoBatch({ queue: items.slice(1), namedType, total: items.length, done: 1 });
    setOcrNote(`Reading screenshot 1 of ${items.length} - confirm or discard each reading; the next screenshot follows automatically.`);
    await processPhotoItem(items[0], namedType, true, `Screenshot 1 of ${items.length}`);
  };

  const scanPhoto = async (source: "upload" | "camera", namedType?: string) => {
    setOcrNote(null);
    if (source === "camera") {
      const { uri, error } = await takePhotoUri();
      if (error) { setOcrNote(error); return; }
      if (!uri) return;
      await processPhotoItem({ uri }, namedType);
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
      await startPhotoBatch(picked.files.map((file) => ({ file })), namedType);
      return;
    }
    const { uris, error } = await pickImageUris();
    if (error) { setOcrNote(error); return; }
    if (!uris.length) {
      setOcrNote("No photo reached HomeTower - the picker closed without a selection arriving. Please try again.");
      return;
    }
    await startPhotoBatch(uris.map((uri) => ({ uri })), namedType);
  };

  // Owner QA round 6: a real FILE upload. The image picker greys PDFs
  // out; tax documents are PDFs. PDFs are read through their text layer
  // (web), images through the OCR path, anything else gets a plain
  // explanation plus the manual-register option below.
  // Owner QA round 9: the picker is now the platform file input (see
  // filePick.web.ts - the library shim returned nothing on iOS), and
  // EVERY step reports into flowNote, rendered right under the buttons:
  // picker opened -> file received (by name) -> reading -> result or
  // the exact error. No silent path remains.
  const uploadFile = async (namedType?: string) => {
    setFlowNote("Opening the file picker...");
    const picked = await pickFile();
    if (picked.error) { setFlowNote(picked.error); return; }
    if (picked.cancelled || (!picked.uri && !picked.file)) {
      setFlowNote("No file reached HomeTower - the picker closed without a selection arriving. Please try again.");
      return;
    }
    setFlowNote(`Received ${picked.name} - reading it now...`);
    try {
      if (picked.file) {
        const f = picked.file;
        if (f.type.includes("pdf") || /\.pdf$/i.test(f.name)) {
          const outcome = await extractPdfTextFromBuffer(await f.arrayBuffer());
          if (outcome.error) { setFlowNote(`Could not read ${f.name}: ${outcome.error}`); return; }
          setFlowNote(null);
          runExtraction(outcome.text, namedType, outcome.pages, outcome.columnByPage);
          return;
        }
        if (f.type.startsWith("image/")) {
          const outcome = await recognizeImageFile(f);
          if (outcome.error) { setFlowNote(`OCR stage ${outcome.stage}: ${outcome.error}`); return; }
          setFlowNote(null);
          runExtraction(outcome.text, namedType);
          return;
        }
        setFlowNote(`${f.name} is not a PDF or a photo - HomeTower reads PDFs and photos. Nothing was saved; the file can be registered manually below.`);
        return;
      }
      const uri = picked.uri as string;
      const isPdf = /\.pdf$/i.test(picked.name ?? "");
      if (isPdf) {
        const outcome = await extractPdfText(uri);
        if (outcome.error) { setFlowNote(`PDF stage: ${outcome.error}`); return; }
        setFlowNote(null);
        runExtraction(outcome.text, namedType, outcome.pages, outcome.columnByPage);
        return;
      }
      const outcome = await recognizeOnDevice(uri);
      if (outcome.error) { setFlowNote(`OCR stage ${outcome.stage}: ${outcome.error}`); return; }
      setFlowNote(null);
      runExtraction(outcome.text, namedType);
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
    const record: DocumentRecord = {
      docType: extractionType,
      status: extraction.status,
      confidence: extraction.confidence,
      capturedOn: today,
      fields: savedFields,
      ...(extractionType === "brokerage_statement" && pendingHoldings && pendingHoldings.positions.length > 0 ? { holdings: pendingHoldings.positions } : {}),
    };
    updateIntake({ documents: [...docs, record] });
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
    setExtraction(null);
    setDetection(null);
    setPendingText(null);
    setPendingHoldings(null);
    setPendingPlan(null);
    setPasteText("");
    setAutoPaste("");
    const moreComing = photoBatch && photoBatch.queue.length > 0 ? ` Screenshot ${photoBatch.done + 1} of ${photoBatch.total} is being read now.` : "";
    setOcrNote(`Saved ${extractionType} (${extraction.status}, confidence ${extraction.confidence}).${assignNote}${moreComing}`);
    advanceBatch();
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
  const EVENT_LABEL: Record<EquityEvent["kind"], string> = { bonus: "Bonus", rsu_vest: "RSU vest", espp_purchase: "ESPP purchase" };
  const lastEvent = state.events.length ? [...state.events].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  const saveEvent = () => {
    const amount = Number(evAmount.replace(/[$,]/g, "")) || 0;
    update({ events: [...state.events, { id: `ev-${Date.now()}`, kind: evKind, date: evDate, amount, note: evNote.trim() }] });
    setShowEventForm(false);
    setEvAmount("");
    setEvNote("");
  };

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Documents</Text>
      <Text style={styles.note}>
        The register of what the household has provided. Capture a document below: the text is read on this device,
        fields are extracted, and you confirm before anything is saved. Freshness is computed per document type.
      </Text>

      {assignChildId && (
        <View style={styles.assignBanner}>
          <Text style={styles.assignText}>
            Filling college savings for {state.family.find((m) => m.id === assignChildId)?.name || "your child"}: upload their 529 statement below (file, photo, or camera) and confirm - the saved balance goes onto their card, and the monthly contribution too if the statement shows one.
          </Text>
          <Pressable onPress={() => setAssignChildId(null)}><Text style={styles.remove}>Cancel assignment</Text></Pressable>
        </View>
      )}

      {docs.length === 0 && <Text style={styles.line}>No documents yet. Capture the first one below.</Text>}
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

      <Text style={styles.section}>Ongoing center</Text>
      <Text style={styles.note}>
        Everything that repeats - payslips, statements, events. Sorted by urgency: what needs you first is on top. Upload straight from each row.
      </Text>
      {[...CATS]
        .map((c) => ({ c, info: catInfo(c) }))
        .sort((a, b) => a.info.rank - b.info.rank)
        .map(({ c, info }) => {
          const chip = chipFor(info.status);
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
                  : `No document yet · Expected ${c.cadence}`}
                {c.extra ? `\n${c.extra}` : ""}
              </Text>
              <View style={styles.catActions}>
                <Pressable style={[styles.button, { flex: 1 }]} onPress={() => uploadFile(c.docType)}>
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
              <View style={styles.catActions}>
                <Pressable style={[styles.buttonGhost, { flex: 1 }]} onPress={() => scanPhoto("upload", c.docType)}>
                  <Text style={styles.buttonGhostText}>📷 Upload a photo</Text>
                </Pressable>
                <Pressable style={[styles.buttonGhost, { flex: 1 }]} onPress={() => scanPhoto("camera", c.docType)}>
                  <Text style={styles.buttonGhostText}>📸 Take a photo</Text>
                </Pressable>
              </View>
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
        <View style={styles.catActions}>
          <Pressable style={[styles.button, { flex: 1 }]} onPress={() => setShowEventForm((s) => !s)}>
            <Text style={styles.buttonText}>Add an event</Text>
          </Pressable>
          <Pressable style={[styles.buttonAlt, { flex: 0.7 }]} onPress={() => uploadFile()}>
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

      <Text style={styles.section}>Upload any document</Text>
      <Text style={styles.note}>
        No need to say what it is: HomeTower reads it, identifies the type, and shows you its reading for approval
        before anything is saved. If you do pick a type below, HomeTower still verifies it against the content.
      </Text>
      <Pressable style={styles.button} onPress={() => uploadFile()}>
        <Text style={styles.buttonText}>Upload a PDF or file - HomeTower identifies it</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("upload")}>
        <Text style={styles.buttonText}>Upload a photo - HomeTower identifies it</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("camera")}>
        <Text style={styles.buttonText}>Take a photo - HomeTower identifies it</Text>
      </Pressable>
      {flowNote && <Text style={styles.note}>{flowNote}</Text>}
      <TextInput
        style={styles.pasteBox}
        multiline
        placeholder="...or paste any document text here and let HomeTower identify it"
        value={autoPaste}
        onChangeText={setAutoPaste}
      />
      <Pressable style={styles.buttonAlt} onPress={() => runExtraction(autoPaste)}>
        <Text style={styles.buttonText}>Read and identify pasted text</Text>
      </Pressable>

      <Text style={styles.section}>What your household needs</Text>
      <Text style={styles.note}>
        Your profile decides this list - HomeTower never asks every household for every document (SPEC45, Smart Document Request Engine).
        Tap an item to upload it right there.
      </Text>
      {requests.map((r) => {
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
                <Pressable style={styles.button} onPress={() => uploadFile(r.docType)}>
                  <Text style={styles.buttonText}>Upload a PDF or file of this document</Text>
                </Pressable>
                <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("upload", r.docType)}>
                  <Text style={styles.buttonText}>Upload a photo of this document</Text>
                </Pressable>
                <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("camera", r.docType)}>
                  <Text style={styles.buttonText}>Take a photo of this document</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}


      <Text style={styles.section}>Capture a document</Text>
      <View style={styles.chips}>
        {[...DOCUMENT_TYPES].map((t) => (
          <Pressable key={t} style={[styles.chip, selectedType === t && styles.chipSelected]} onPress={() => setSelectedType(t)}>
            <Text style={selectedType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.button} onPress={() => uploadFile(selectedType)}>
        <Text style={styles.buttonText}>Upload a PDF or file of the {selectedType}</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("upload", selectedType)}>
        <Text style={styles.buttonText}>Upload a photo of the {selectedType}</Text>
      </Pressable>
      <Pressable style={styles.buttonAlt} onPress={() => scanPhoto("camera", selectedType)}>
        <Text style={styles.buttonText}>Take a photo of the {selectedType}</Text>
      </Pressable>
      <TextInput
        style={styles.pasteBox}
        multiline
        placeholder="...or paste the document text here (works on every platform)"
        value={pasteText}
        onChangeText={setPasteText}
      />
      <Pressable style={styles.buttonAlt} onPress={() => runExtraction(pasteText, selectedType)}>
        <Text style={styles.buttonText}>Extract fields from pasted text</Text>
      </Pressable>
      {ocrNote && <Text style={styles.note}>{ocrNote}</Text>}
      {flowNote && <Text style={styles.note}>{flowNote}</Text>}

      {extraction && (
        <View style={styles.confirmCard} onLayout={(e) => { confirmY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.section}>Confirm HomeTower's reading</Text>
          {photoBatch && (
            <Text style={styles.batchLine}>Screenshot {photoBatch.done} of {photoBatch.total} - confirm this one and the next follows.</Text>
          )}
          {detection && detection.level !== "unknown" && (
            <Text style={styles.line}>
              This looks like a {detection.docType} ({detection.level} match) - signals: {detection.signals.join(", ")}.
            </Text>
          )}
          {detection && detection.level === "unknown" && (
            <Text style={styles.line}>The app could not identify this document from its content - pick the type below.</Text>
          )}
          {detection && detection.level !== "unknown" && detection.docType !== extractionType && (
            <View style={styles.mismatch}>
              <Text style={styles.line}>
                Heads up: it will be saved as {extractionType}, but the content looks like a {detection.docType}.
              </Text>
              <Pressable style={styles.button} onPress={() => reextractAs(detection.docType)}>
                <Text style={styles.buttonText}>Save as {detection.docType} instead</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.line}>Saving as: {extractionType} - Confidence: {extraction.confidence} - status if saved: {extraction.status}</Text>
          <Text style={styles.line}>Wrong type? Tap the right one - the fields are re-read:</Text>
          <View style={styles.chips}>
            {[...DOCUMENT_TYPES].map((t) => (
              <Pressable key={t} style={[styles.chip, extractionType === t && styles.chipSelected]} onPress={() => reextractAs(t)}>
                <Text style={extractionType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
              </Pressable>
            ))}
          </View>
          {Object.entries(extraction.fields).map(([k, v]) => (
            <Text key={k} style={styles.line}>{k}: {String(v)}</Text>
          ))}
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
          {Object.keys(extraction.fields).length === 0 && (
            <Text style={styles.line}>No known fields matched this document type. You can still save it as a register entry.</Text>
          )}
          <Pressable style={styles.button} onPress={confirmExtraction}>
            <Text style={styles.buttonText}>
              {photoBatch
                ? photoBatch.queue.length > 0
                  ? `Confirm and save (${photoBatch.done} of ${photoBatch.total}) - next follows`
                  : `Confirm and save (${photoBatch.total} of ${photoBatch.total}) - last one`
                : `Confirm and save as ${extractionType}`}
            </Text>
          </Pressable>
          <Pressable onPress={() => { setExtraction(null); setDetection(null); setPendingText(null); setPendingHoldings(null); setPendingPlan(null); advanceBatch(); }}>
            <Text style={styles.remove}>{photoBatch ? `Discard (${photoBatch.done} of ${photoBatch.total})` : "Discard"}</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={addManual}>
        <Text style={styles.manualLink}>No text handy? Register {selectedType} manually (today, no extraction)</Text>
      </Pressable>
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
