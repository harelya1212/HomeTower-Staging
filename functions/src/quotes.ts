// Server-side quotes from Yahoo Finance's chart endpoint (keyless).
// Server fetch has no CORS restriction (the browser does - that is
// why the web app reads quotes through the quotes() function).
// The provider is isolated in this one file so it can be swapped
// (a licensed feed) without touching the sender or the app.
import type { Quote } from "./market.js";

export async function fetchQuotesServer(tickers: string[]): Promise<{ quotes: Record<string, Quote>; asOf: string | null }> {
  const quotes: Record<string, Quote> = {};
  let asOf: string | null = null;
  for (const t of tickers) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1d&interval=1d`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeTower/1.0)" },
      });
      const j = (await r.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketTime?: number } }[] } };
      const meta = j.chart?.result?.[0]?.meta;
      if (meta && typeof meta.regularMarketPrice === "number" && typeof meta.regularMarketChangePercent === "number") {
        quotes[t] = { price: meta.regularMarketPrice, changePct: meta.regularMarketChangePercent };
        if (meta.regularMarketTime) asOf = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);
      }
    } catch {
      // A missing quote excludes the ticker from the report; the
      // composer lists it as missing rather than estimating it.
    }
  }
  return { quotes, asOf };
}
