// Live quotes - native/default variant (Metro resolves the .web
// variant for web builds; import this module extensionless).
// Native fetch has no CORS restriction, so quotes come straight
// from Yahoo Finance's chart endpoint (keyless). Prices are used
// ONLY for the market-close report; nothing about the user leaves
// the device in this path - the request names tickers, nothing else.
import type { Quote } from "./market.ts";

export interface QuotesOutcome {
  quotes: Record<string, Quote>;
  asOf: string | null;
  error: string | null;
  notConnected?: boolean;
}

export async function fetchQuotes(tickers: string[]): Promise<QuotesOutcome> {
  const quotes: Record<string, Quote> = {};
  let asOf: string | null = null;
  let failures = 0;
  for (const t of tickers) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1d&interval=1d`, {
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15" },
      });
      const j = (await r.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketTime?: number } }[] } };
      const meta = j.chart?.result?.[0]?.meta;
      if (meta && typeof meta.regularMarketPrice === "number" && typeof meta.regularMarketChangePercent === "number") {
        quotes[t] = { price: meta.regularMarketPrice, changePct: meta.regularMarketChangePercent };
        if (meta.regularMarketTime) asOf = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);
      } else {
        failures++;
      }
    } catch {
      failures++;
    }
  }
  if (Object.keys(quotes).length === 0 && tickers.length > 0) {
    return { quotes, asOf: null, error: "Could not load closing prices - check the connection and try again." };
  }
  return { quotes, asOf, error: failures > 0 ? "Some prices did not load." : null };
}
