// Holdings sync for the daily market-close push - CONSENT-GATED.
//
// Nothing in this module runs unless the user turned the consent on
// in Intake. What leaves the device is exactly: the device secret
// (a random id generated on-device, used as the subscription key),
// the push token (attached by the native app), the holdings list
// (ticker + quantity per position, incl. derived vested plan
// shares), and the cash total. No names, no documents, no balances
// beyond the cash figure the report itself needs. Withdrawal of
// consent deletes the subscription server-side. Full design:
// MARKET_PUSH.md.
import { MARKET_API_BASE } from "./config.ts";
import { deriveHoldings } from "./market.ts";
import type { HouseholdState } from "./store.tsx";

export function newDeviceSecret(): string {
  return `ht-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface SyncOutcome {
  ok: boolean;
  message: string;
}

export async function syncMarketHoldings(state: HouseholdState, pushToken: string | null): Promise<SyncOutcome> {
  const mp = state.marketPush;
  if (!mp.consent || !mp.deviceSecret) return { ok: false, message: "Consent is off - nothing was sent." };
  if (!MARKET_API_BASE) return { ok: false, message: "Sender not connected yet - the holdings stay on this device until the backend setup step is done." };
  const { positions, cash } = deriveHoldings(state.intake.documents);
  try {
    const r = await fetch(`${MARKET_API_BASE}/syncMarketHoldings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSecret: mp.deviceSecret, pushToken, consent: true, positions, cash }),
    });
    if (!r.ok) return { ok: false, message: `Sender answered ${r.status} - nothing was registered.` };
    return { ok: true, message: "Holdings snapshot registered with the sender." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function withdrawMarketConsent(state: HouseholdState): Promise<SyncOutcome> {
  const mp = state.marketPush;
  if (!MARKET_API_BASE || !mp.deviceSecret) return { ok: true, message: "Consent off. Nothing was registered, so nothing to delete." };
  try {
    await fetch(`${MARKET_API_BASE}/syncMarketHoldings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSecret: mp.deviceSecret, consent: false }),
    });
    return { ok: true, message: "Consent off - the sender was told to delete the subscription." };
  } catch {
    return { ok: false, message: "Consent off on this device. The delete request did not reach the sender - it will be retried on the next sync." };
  }
}
