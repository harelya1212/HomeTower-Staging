import { useNavigation } from "@react-navigation/native";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { esppDisposition, rsuVest } from "../../engine/equity.ts";
import { computeFederalTax } from "../../engine/federal.ts";
import { fbarRequired, foreignTaxCredit, form8938Required } from "../../engine/foreign.ts";
import { simulate } from "../../engine/taximpact.ts";
import { treatyPosition, withholdingCap } from "../../engine/treaty.ts";
import { DateField, usToIso } from "../components/Fields.tsx";
import { positionValue } from "../holdings.ts";
import type { Holding } from "../../engine/intake.ts";
import { useHousehold } from "../store.tsx";
import { money, NAVY, TEAL } from "./HomeScreen.tsx";

type Tool = "sale" | "equity" | "foreign";

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="numeric" />
    </View>
  );
}
function Dat({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <DateField value={value} onChange={onChange} />
    </View>
  );
}
function Txt({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} />
    </View>
  );
}
const n = (v: string) => Number(v) || 0;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function SaleTool() {
  const { state } = useHousehold();
  const [ticker, setTicker] = useState("XYZ");
  const [qty, setQty] = useState("100");
  const [basis, setBasis] = useState("50");
  const [price, setPrice] = useState("80");
  const [buy, setBuy] = useState("2025-06-01");
  const [sell, setSell] = useState("2026-01-15");
  const [lotNote, setLotNote] = useState<string | null>(null);

  // Owner QA round 4: the lot should come from a LIST - the household's
  // own recorded sales (parsed 1099-B documents) - not from typing.
  const recordedSales = state.intake.documents
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.docType === "1099b" && d.status === "parsed" && d.fields);
  // Holdings parsed from brokerage app screenshots (round 22): the
  // positions the household holds NOW, newest capture first, one row
  // per ticker. Basis = the app's Price Paid; the screenshot carries
  // no purchase date, so the date stays for the user to set.
  const holdingsDocs = state.intake.documents
    .filter((d) => d.holdings && d.holdings.length > 0)
    .sort((a, b) => (b.capturedOn ?? "").localeCompare(a.capturedOn ?? ""));
  const holdings = (() => {
    const seen = new Set<string>();
    const out: Array<{ h: Holding; capturedOn?: string | null }> = [];
    for (const d of holdingsDocs) {
      for (const h of d.holdings ?? []) {
        if (!seen.has(h.ticker)) {
          seen.add(h.ticker);
          out.push({ h, capturedOn: d.capturedOn });
        }
      }
    }
    return out;
  })();
  const holdingsCash = (() => {
    const c = Number(holdingsDocs[0]?.fields?.["cash_balance"]);
    return Number.isFinite(c) && c > 0 ? c : 0;
  })();
  const applyHolding = (h: Holding, capturedOn?: string | null) => {
    setTicker(h.ticker);
    setQty(String(h.quantity));
    setBasis(String(h.pricePaid));
    setPrice(String(h.lastPrice));
    setLotNote(
      `Filled from your holdings${capturedOn ? ` (captured ${capturedOn})` : ""}: ${h.ticker} ${h.quantity} shares - basis $${h.pricePaid.toLocaleString("en-US")}/share (the Price Paid on your screenshot), now $${h.lastPrice.toLocaleString("en-US")}. The screenshot shows no purchase date - set it below for the short/long-term split.`,
    );
  };
  const applySale = (fields: Record<string, string>, capturedOn?: string | null) => {
    const q = Number(fields["quantity"]);
    const proceeds = Number(fields["proceeds"]);
    const basisTotal = Number(fields["cost_basis"]);
    if (fields["description"]) setTicker(fields["description"].slice(0, 12).toUpperCase());
    if (q > 0) {
      setQty(String(q));
      if (proceeds > 0) setPrice((proceeds / q).toFixed(2));
      if (basisTotal > 0) setBasis((basisTotal / q).toFixed(2));
    }
    const acq = fields["date_acquired"] ? usToIso(fields["date_acquired"]) ?? (/^\d{4}-\d{2}-\d{2}$/.test(fields["date_acquired"]) ? fields["date_acquired"] : null) : null;
    if (acq) setBuy(acq);
    const sold = fields["date_sold"] ? usToIso(fields["date_sold"]) ?? (/^\d{4}-\d{2}-\d{2}$/.test(fields["date_sold"]) ? fields["date_sold"] : null) : null;
    if (sold) setSell(sold);
    setLotNote(
      `Filled from your 1099-B${capturedOn ? ` (captured ${capturedOn})` : ""}: proceeds $${(proceeds || 0).toLocaleString("en-US")}, total basis $${(basisTotal || 0).toLocaleString("en-US")}` +
      (q > 0 ? " - per-share values computed from the quantity." : " - add the quantity and the per-share values are computed for you.") +
      " Check the fields below and adjust.",
    );
  };
  const result = useMemo(() => {
    if (!isDate(buy) || !isDate(sell)) return null;
    try {
      return simulate(
        { ticker, broker: "manual", quantity: n(qty), costBasisPerShare: n(basis), salePricePerShare: n(price), purchaseDate: buy, saleDate: sell },
        { filingStatus: state.intake.filingStatus, taxYear: 2026, state: state.intake.state, estimatedOrdinaryIncome: state.grossIncome },
      );
    } catch {
      return null;
    }
  }, [ticker, qty, basis, price, buy, sell, state]);
  return (
    <View style={styles.tool}>
      {recordedSales.length > 0 ? (
        <>
          <Text style={styles.label}>Your recorded sales - tap one to fill the tool</Text>
          {recordedSales.map(({ d, i }) => (
            <Pressable key={i} style={styles.lotRow} onPress={() => applySale(d.fields as Record<string, string>, d.capturedOn)}>
              <Text style={styles.lotText}>
                1099-B{d.capturedOn ? ` - ${d.capturedOn}` : ""}: proceeds ${(Number(d.fields?.["proceeds"]) || 0).toLocaleString("en-US")} - basis ${(Number(d.fields?.["cost_basis"]) || 0).toLocaleString("en-US")} - gain/loss ${(Number(d.fields?.["gain_loss"]) || 0).toLocaleString("en-US")}
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <Text style={styles.line}>No recorded sales yet. Upload a 1099-B in the Documents tab and your sales appear here as a list - no typing. The fields below stay as a manual fallback.</Text>
      )}
      {lotNote && <Text style={styles.line}>{lotNote}</Text>}
      {holdings.length > 0 && (
        <>
          <Text style={styles.label}>Your holdings - tap one to fill the tool</Text>
          {holdings.map(({ h, capturedOn }) => (
            <Pressable key={h.ticker} style={styles.lotRow} onPress={() => applyHolding(h, capturedOn)}>
              <Text style={styles.lotText}>
                {h.ticker} - {h.quantity} shares - basis ${h.pricePaid.toLocaleString("en-US")} - now ${h.lastPrice.toLocaleString("en-US")} - value ${positionValue(h).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </Text>
            </Pressable>
          ))}
          {(() => {
            const total = holdings.reduce((a, { h }) => a + positionValue(h), 0) + holdingsCash;
            const top = holdings.reduce((a, { h }) => (positionValue(h) > positionValue(a.h) ? { h } : a), holdings[0]);
            const pct = total > 0 ? (positionValue(top.h) / total) * 100 : 0;
            const band = pct < 20 ? "manageable" : pct < 35 ? "watch" : pct < 50 ? "high" : "severe";
            return (
              <Text style={styles.line}>
                Concentration: {top.h.ticker} is the largest position at {pct.toFixed(0)}% of this account (positions + cash) - {band} (guide: under 20% manageable, 20-35% watch, 35-50% high, over 50% severe).
              </Text>
            );
          })()}
        </>
      )}
      <Txt label="Ticker" value={ticker} onChange={setTicker} />
      <Num label="Quantity" value={qty} onChange={setQty} />
      <Num label="Cost basis per share ($)" value={basis} onChange={setBasis} />
      <Num label="Sale price per share ($)" value={price} onChange={setPrice} />
      <Dat label="Purchase date" value={buy} onChange={setBuy} />
      <Dat label="Sale date" value={sell} onChange={setSell} />
      {result ? (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>{result.summary}</Text>
          <Text style={styles.line}>Federal: {money(result.impact.federalTax)} - NIIT: {money(result.impact.niit)} - State: {money(result.impact.stateTax)}</Text>
          <Text style={styles.line}>Alert: {result.bracketAlert}</Text>
          {result.timing && <Text style={styles.line}>If you wait {result.timing.daysUntilLongTerm} more days (long-term): save {money(result.timing.taxSavingsByWaiting)}.</Text>}
          {result.impact.washSale.triggered && <Text style={styles.line}>{result.impact.washSale.explanation}</Text>}
        </View>
      ) : (
        <Text style={styles.line}>Enter valid dates to see the impact.</Text>
      )}
    </View>
  );
}

function EquityTool() {
  const { state } = useHousehold();
  const [shares, setShares] = useState("1000");
  const [fmv, setFmv] = useState("50");
  const [vest, setVest] = useState("2026-03-01");
  const rsu = useMemo(() => {
    if (!isDate(vest)) return null;
    try {
      return rsuVest(n(shares), n(fmv), vest, state.intake.filingStatus, state.grossIncome);
    } catch {
      return null;
    }
  }, [shares, fmv, vest, state]);

  const [eShares, setEShares] = useState("100");
  const [grant, setGrant] = useState("2023-01-01");
  const [grantFmv, setGrantFmv] = useState("40");
  const [purchase, setPurchase] = useState("2023-07-01");
  const [purchaseFmv, setPurchaseFmv] = useState("50");
  const [purchasePrice, setPurchasePrice] = useState("34");
  const [saleD, setSaleD] = useState("2025-08-01");
  const [saleP, setSaleP] = useState("60");
  const espp = useMemo(() => {
    if (![grant, purchase, saleD].every(isDate)) return null;
    try {
      return esppDisposition(n(eShares), grant, n(grantFmv), purchase, n(purchaseFmv), n(purchasePrice), saleD, n(saleP));
    } catch {
      return null;
    }
  }, [eShares, grant, grantFmv, purchase, purchaseFmv, purchasePrice, saleD, saleP]);

  return (
    <View style={styles.tool}>
      <Text style={styles.section}>RSU vesting</Text>
      <Num label="Shares vesting" value={shares} onChange={setShares} />
      <Num label="FMV at vest ($)" value={fmv} onChange={setFmv} />
      <Dat label="Vest date" value={vest} onChange={setVest} />
      {rsu && (
        <View style={styles.result}>
          <Text style={styles.line}>Ordinary income at vest: {money(rsu.ordinaryIncome)}</Text>
          <Text style={styles.line}>Federal withheld at the supplemental rate: {money(rsu.federalWithheld)}</Text>
          <Text style={styles.line}>Projected additional tax inside your household: {money(rsu.projectedAdditionalTax)}</Text>
          <Text style={styles.resultTitle}>Projected gap at filing: {money(rsu.projectedGap)} {rsu.projectedGap > 0 ? "(still owed)" : "(over-withheld)"}</Text>
        </View>
      )}
      <Text style={styles.section}>ESPP disposition</Text>
      <Num label="Shares" value={eShares} onChange={setEShares} />
      <Dat label="Grant date" value={grant} onChange={setGrant} />
      <Num label="Grant-date FMV ($)" value={grantFmv} onChange={setGrantFmv} />
      <Dat label="Purchase date" value={purchase} onChange={setPurchase} />
      <Num label="Purchase-date FMV ($)" value={purchaseFmv} onChange={setPurchaseFmv} />
      <Num label="Purchase price ($)" value={purchasePrice} onChange={setPurchasePrice} />
      <Dat label="Sale date" value={saleD} onChange={setSaleD} />
      <Num label="Sale price ($)" value={saleP} onChange={setSaleP} />
      {espp && (
        <View style={styles.result}>
          <Text style={styles.resultTitle}>Classification: {espp.classification}</Text>
          <Text style={styles.line}>Ordinary income: {money(espp.ordinaryIncomeTotal)}</Text>
          <Text style={styles.line}>Capital gain: {money(espp.capitalGainTotal)} ({espp.capitalIsLongTerm ? "long-term" : "short-term"}), basis {money(espp.basisPerShare)}/share</Text>
        </View>
      )}
    </View>
  );
}

function ForeignTool() {
  const { state } = useHousehold();
  const [balances, setBalances] = useState("6000, 5000");
  const [lastDay, setLastDay] = useState("120000");
  const [maxAny, setMaxAny] = useState("130000");
  const [abroad, setAbroad] = useState(false);
  const [taxPaid, setTaxPaid] = useState("5000");
  const [foreignIncome, setForeignIncome] = useState("20000");
  const [incomeType, setIncomeType] = useState<"dividends" | "interest" | "royalties">("dividends");
  const [direct, setDirect] = useState(false);
  const [citizen, setCitizen] = useState(true);

  const balanceList = balances.split(",").map((x) => Number(x.trim()) || 0).filter((x) => x > 0);
  const fbar = fbarRequired(balanceList);
  const f8938 = form8938Required(n(lastDay), n(maxAny), state.intake.filingStatus, abroad);
  const fed = computeFederalTax(state.grossIncome, state.intake.filingStatus, state.ltcgIncome);
  const ftc = foreignTaxCredit(n(taxPaid), n(foreignIncome), Math.max(1, fed.taxableIncome), fed.totalTax);
  const cap = withholdingCap(incomeType, { corporate10pct: direct });
  const ss = treatyPosition("social_security_benefits", citizen);
  const pension = treatyPosition("private_pensions", citizen);

  return (
    <View style={styles.tool}>
      <Text style={styles.section}>Foreign accounts (FBAR / Form 8938)</Text>
      <Txt label="Max balance per account, comma separated ($)" value={balances} onChange={setBalances} />
      <Text style={styles.line}>{fbar.required ? "🔴" : "🟢"} FBAR: {fbar.reason}</Text>
      <Num label="Total foreign assets - last day of year ($)" value={lastDay} onChange={setLastDay} />
      <Num label="Total foreign assets - max at any time ($)" value={maxAny} onChange={setMaxAny} />
      <Pressable onPress={() => setAbroad(!abroad)}><Text style={styles.link}>Living abroad: {abroad ? "yes" : "no"} (tap to change)</Text></Pressable>
      <Text style={styles.line}>{f8938.required ? "🔴" : "🟢"} 8938: {f8938.reason}</Text>

      <Text style={styles.section}>Foreign tax credit (simplified, one basket)</Text>
      <Num label="Foreign taxes paid ($)" value={taxPaid} onChange={setTaxPaid} />
      <Num label="Foreign-source taxable income ($)" value={foreignIncome} onChange={setForeignIncome} />
      <Text style={styles.line}>Credit allowed: {money(ftc.creditAllowed)} of {money(ftc.foreignTaxesPaid)} paid - excess {money(ftc.excessCredit)} carries back 1 year, forward 10.</Text>
      <Text style={styles.note}>Limitation uses your projected federal tax and taxable income from the engine, on the income in the Intake tab.</Text>

      <Text style={styles.section}>US-Israel treaty</Text>
      <View style={styles.chips}>
        {(["dividends", "interest", "royalties"] as const).map((t) => (
          <Pressable key={t} style={[styles.chip, incomeType === t && styles.chipSelected]} onPress={() => setIncomeType(t)}>
            <Text style={incomeType === t ? styles.chipTextSelected : styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {incomeType === "dividends" && (
        <Pressable onPress={() => setDirect(!direct)}><Text style={styles.link}>Corporate holder with 10%+ voting power: {direct ? "yes" : "no"} (tap)</Text></Pressable>
      )}
      <Text style={styles.line}>Withholding cap: {(cap.treatyCapRate * 100).toFixed(1)}% - {cap.articleNote}</Text>
      <Pressable onPress={() => setCitizen(!citizen)}><Text style={styles.link}>US citizen: {citizen ? "yes" : "no"} (tap to change)</Text></Pressable>
      <Text style={styles.line}>Social Security: taxable in {ss.taxableIn.replaceAll("_", " ")}; saving clause overrides: {ss.savingClauseOverrides ? "yes" : "no"}.</Text>
      <Text style={styles.line}>Private pensions: taxable in {pension.taxableIn.replaceAll("_", " ")}; saving clause overrides for a US citizen: {pension.savingClauseOverrides ? "yes" : "no"}.</Text>
    </View>
  );
}

export default function PlanScreen() {
  const [tool, setTool] = useState<Tool>("sale");
  const navigation = useNavigation<any>();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable style={styles.lifeCard} onPress={() => navigation.navigate("Lifestyle")}>
        <Text style={styles.lifeTitle}>Retirement Lifestyle</Text>
        <Text style={styles.lifeText}>Build your target from your real spending - what continues, what ends, what changes. ›</Text>
      </Pressable>
      <Text style={styles.title}>Plan a move</Text>
      <Text style={styles.note}>Every tool runs on your household numbers from the Intake tab. Nothing here is a filing - it is the projected consequence, before you act.</Text>
      <View style={styles.chips}>
        <Pressable style={[styles.chip, tool === "sale" && styles.chipSelected]} onPress={() => setTool("sale")}><Text style={tool === "sale" ? styles.chipTextSelected : styles.chipText}>Sale - TaxImpact</Text></Pressable>
        <Pressable style={[styles.chip, tool === "equity" && styles.chipSelected]} onPress={() => setTool("equity")}><Text style={tool === "equity" ? styles.chipTextSelected : styles.chipText}>RSU / ESPP</Text></Pressable>
        <Pressable style={[styles.chip, tool === "foreign" && styles.chipSelected]} onPress={() => setTool("foreign")}><Text style={tool === "foreign" ? styles.chipTextSelected : styles.chipText}>Foreign / Treaty</Text></Pressable>
      </View>
      {tool === "sale" && <SaleTool />}
      {tool === "equity" && <EquityTool />}
      {tool === "foreign" && <ForeignTool />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FA" },
  content: { padding: 16, paddingBottom: 74, gap: 10 },
  lifeCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 4, borderWidth: 1, borderColor: TEAL },
  lifeTitle: { fontSize: 17, fontWeight: "800", color: NAVY },
  lifeText: { fontSize: 14, color: "#22303C", lineHeight: 20 },
  title: { fontSize: 22, fontWeight: "700", color: NAVY },
  note: { fontSize: 13, color: "#5A6B7C" },
  section: { fontSize: 16, fontWeight: "700", color: NAVY, marginTop: 12 },
  tool: { gap: 8 },
  lotRow: { backgroundColor: "#E6F4F6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  lotText: { fontSize: 15, color: NAVY, fontWeight: "600" },
  field: { gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: TEAL },
  input: { backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  line: { fontSize: 14, color: "#22303C" },
  link: { fontSize: 14, color: TEAL, fontWeight: "600" },
  result: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 5, borderWidth: 1, borderColor: TEAL },
  resultTitle: { fontSize: 15, fontWeight: "700", color: NAVY },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: TEAL, paddingHorizontal: 10, paddingVertical: 5 },
  chipSelected: { backgroundColor: TEAL },
  chipText: { color: TEAL, fontSize: 12, fontWeight: "600" },
  chipTextSelected: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});
