# Daily Market-Close Push - design and state

Owner directive (2026-11-07, approved "build now, full, with
consent"): every trading day, half an hour after the US market
close, the user gets a push in this exact format, computed from
the holdings they last entered in the app plus live closing
prices:

```
⚠️ INTC: $56.28, +7.71%
⚠️ MU: $690.00, +5.12%
⚠️ ETN: $341.72, +4.50%
VNM: $17.13, +1.84%
QQQ: $656.10, +1.40%
META: $610.15, +0.84%
SPY: $735.29, +0.31%

תיק מוערך היום: כ-+$4,168 על האחזקות (כ-+4.5%), וכ-+3.2% כולל המזומן (הערכה לפי כמויות הבסיס).
```

Format rules (composed by app/src/market.ts, mirrored in
functions/src/market.ts):
- One line per holding, sorted by daily % change, biggest first.
- ⚠️ marks a move of 4% or more in either direction.
- Footer: the day's estimated gain on the holdings (dollars and
  %), and the % including the cash total, always labelled an
  estimate based on the entered quantities.
- Holdings derive from the user's own documents: positions merge
  by ticker, newest document wins per ticker; a stock-plan
  document contributes its VESTED shares only (share count derived
  at save time from the vested balance and the plan's own last
  price); unvested shares are never counted. A ticker with no live
  quote is excluded and listed as missing - never estimated.

## The consent boundary (why a server is involved at all)

HomeTower is local-first: a scheduled push with live prices
cannot be composed on the device, so a small sender exists. The
sender can only work with what it is given, therefore:

- The feature is OFF by default. It turns on only when the user
  flips the explicit consent toggle in Intake, under this text
  (verbatim in the app): "The sender is a server, and your
  holdings live only on this device - so this push works only if
  you agree to let HomeTower copy JUST this to the sender: your
  stock tickers and quantities, your cash total, and this
  device's push address. No names, no documents, no account
  numbers. Turn it off any time and the copy is deleted."
- The complete data inventory that can leave the device for this
  feature: a random on-device secret (the subscription key),
  ticker symbols, quantities, one cash total, and the Expo push
  token. Nothing else. Firestore holds one document per
  subscription under the secret; client access to the collection
  is denied by rule - only the functions (Admin SDK) touch it.
- Turning consent off deletes the subscription server-side
  (syncMarketHoldings with consent != true deletes the document).

## Pieces

- App: composition + holdings derivation (src/market.ts), the
  Home "Market close" card (live computation on open), weekday
  16:30 ET local reminders for households with holdings
  (src/push.ts nextMarketCloses - DST-correct), the consent
  toggle and sync client (src/marketSync.ts).
- Quotes: Yahoo Finance chart endpoint (keyless). Native fetches
  it directly; browsers cannot (no CORS headers - verified from
  the staging origin), so the web app reads through the backend's
  quotes endpoint, which fetches server-side. The provider is
  isolated (app/src/quotes*.ts, functions/src/quotes.ts) so a
  licensed feed can replace it in one place. Stooq is not usable
  (bot wall).
- Backend (functions/): quotes (CORS-open proxy), 
  syncMarketHoldings (validate + upsert/delete a subscription),
  marketClosePush (schedule "30 16 * * 1-5", America/New_York;
  fetches one quote set for all subscriptions, composes per
  household, sends via the Expo push API, clears dead tokens on
  DeviceNotRegistered; if no fresh quotes come back - holiday or
  outage - it sends nothing rather than a stale report).

## Remaining activation step (one guided session)

1. Create the Firebase project for HomeTower (owner's Google
   account, Blaze plan like TReps) and `firebase deploy` from
   functions/ - deploys all three functions + the rules.
2. Put the functions base URL into app/src/config.ts
   (MARKET_API_BASE) and redeploy the web app - the web close
   card and the sync light up.
3. The remote push itself fires once the native app issues Expo
   push tokens (the native milestone in NATIVE.md); the token
   attaches to the subscription on the next sync.
