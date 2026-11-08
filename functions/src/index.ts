// HomeTower backend - three functions (see MARKET_PUSH.md):
//   quotes              - CORS-open quote proxy for the web app.
//   syncMarketHoldings  - the consent-gated subscription endpoint.
//   marketClosePush     - weekdays 16:30 America/New_York: compose
//                         each consented household's close report
//                         and send it as an Expo push.
// Firestore is accessed only through the Admin SDK here; the
// firestore.rules deny all client access to the collection.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { composeCloseReport, pushText, type PositionQty } from "./market.js";
import { fetchQuotesServer } from "./quotes.js";

initializeApp();
const db = getFirestore();
const COLLECTION = "marketPush";

function cors(res: { set: (k: string, v: string) => void }): void {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

export const quotes = onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z][A-Z0-9.]{0,5}$/.test(s))
    .slice(0, 30);
  if (symbols.length === 0) {
    res.status(400).json({ error: "symbols required" });
    return;
  }
  const out = await fetchQuotesServer(symbols);
  res.json(out);
});

interface SyncBody {
  deviceSecret?: string;
  pushToken?: string | null;
  consent?: boolean;
  positions?: PositionQty[];
  cash?: number | null;
}

export const syncMarketHoldings = onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const body = (req.body ?? {}) as SyncBody;
  const secret = String(body.deviceSecret ?? "");
  if (!/^ht-[a-z0-9-]{8,64}$/.test(secret)) {
    res.status(400).json({ error: "deviceSecret invalid" });
    return;
  }
  const ref = db.collection(COLLECTION).doc(secret);
  if (body.consent !== true) {
    await ref.delete();
    res.json({ ok: true, deleted: true });
    return;
  }
  const positions = (Array.isArray(body.positions) ? body.positions : [])
    .filter((p) => p && /^[A-Z][A-Z0-9.]{0,5}$/.test(String(p.ticker)) && Number(p.quantity) > 0)
    .slice(0, 50)
    .map((p) => ({ ticker: String(p.ticker), quantity: Number(p.quantity), derived: p.derived === true }));
  const cash = typeof body.cash === "number" && body.cash >= 0 ? body.cash : null;
  await ref.set(
    {
      positions,
      cash,
      ...(typeof body.pushToken === "string" && body.pushToken ? { pushToken: body.pushToken } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  res.json({ ok: true, positions: positions.length });
});

export const marketClosePush = onSchedule({ schedule: "30 16 * * 1-5", timeZone: "America/New_York" }, async () => {
  const snap = await db.collection(COLLECTION).get();
  const subs = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { pushToken?: string; positions?: PositionQty[]; cash?: number | null }) }))
    .filter((s) => s.pushToken && Array.isArray(s.positions) && s.positions.length > 0);
  if (subs.length === 0) return;
  const tickers = [...new Set(subs.flatMap((s) => (s.positions ?? []).map((p) => p.ticker)))];
  const { quotes: live } = await fetchQuotesServer(tickers);
  if (Object.keys(live).length === 0) return; // no fresh close (holiday/outage) - no push, never a stale one
  const messages: { to: string; title: string; body: string; sound: "default" }[] = [];
  for (const s of subs) {
    const report = composeCloseReport(s.positions ?? [], s.cash ?? null, live);
    if (report.lines.length === 0) continue;
    messages.push({ to: s.pushToken as string, title: "HomeTower - market close", body: pushText(report), sound: "default" });
  }
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(chunk),
    });
    const tickets = (await r.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } }[] } | null;
    if (tickets?.data) {
      for (let k = 0; k < tickets.data.length; k++) {
        if (tickets.data[k]?.details?.error === "DeviceNotRegistered") {
          const dead = chunk[k]?.to;
          const doc = subs.find((s) => s.pushToken === dead);
          if (doc) await db.collection(COLLECTION).doc(doc.id).set({ pushToken: null }, { merge: true });
        }
      }
    }
  }
});
