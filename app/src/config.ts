// App configuration constants.
// MARKET_API_BASE: the HomeTower backend (Firebase Cloud Functions -
// see functions/ and MARKET_PUSH.md). Project "hometower" created and
// functions deployed 2026-11-08 (owner-guided session): quotes,
// syncMarketHoldings and marketClosePush live in us-central1 on
// Node 22. Web quote fetching goes through this base; the consent
// sync posts here too. The remote market-close push still needs a
// native push token (issued by the native app) to reach a device.
export const MARKET_API_BASE = "https://us-central1-hometower.cloudfunctions.net";
