// Live quotes - WEB variant. Yahoo's chart endpoint sends no CORS
// headers (verified from this origin, 2026-11-07: "Failed to
// fetch"), so a browser cannot read prices directly. The web app
// therefore reads through the HomeTower backend's quotes endpoint
// (functions/), which fetches server-side and returns the same
// normalized shape. Until the backend is connected, the outcome is
// an honest notConnected - the close card says so and shows the
// holdings basis it would use.
import { MARKET_API_BASE } from "./config.ts";
import type { Quote } from "./market.ts";

export interface QuotesOutcome {
  quotes: Record<string, Quote>;
  asOf: string | null;
  error: string | null;
  notConnected?: boolean;
}

export async function fetchQuotes(tickers: string[]): Promise<QuotesOutcome> {
  if (!MARKET_API_BASE) {
    return { quotes: {}, asOf: null, error: null, notConnected: true };
  }
  try {
    const r = await fetch(`${MARKET_API_BASE}/quotes?symbols=${tickers.map(encodeURIComponent).join(",")}`);
    const j = (await r.json()) as { asOf?: string; quotes?: Record<string, Quote> };
    return { quotes: j.quotes ?? {}, asOf: j.asOf ?? null, error: null };
  } catch {
    return { quotes: {}, asOf: null, error: "Could not load closing prices - check the connection and try again." };
  }
}
