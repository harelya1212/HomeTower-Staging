// App configuration constants.
// MARKET_API_BASE: the HomeTower backend (Firebase Cloud Functions -
// see functions/ and MARKET_PUSH.md). Empty until the Firebase
// project is created and the functions are deployed (one guided
// step). While empty, web quote fetching reports "not connected"
// honestly; the native app fetches quotes directly and the remote
// market-close push activates when the backend + a native push
// token exist.
export const MARKET_API_BASE = "";
