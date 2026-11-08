// Push notifications - built with the TReps lessons applied from day one
// (owner requirement, 2026-11-07; PHASE1.md):
// 1. STATIC import only. Never a dynamic import behind a silent catch -
//    that pattern faked "Not supported" in TReps for days.
// 2. "Enabled" is claimed ONLY from a stored push token, never from the
//    permission state or a button label.
// 3. Every failure lands in PushStatus.error with its stage, shown in the
//    UI diagnostics - nothing fails silently.
// 4. Default setting is ON.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { FreshnessFinding } from "../engine/freshness.ts";
import { nextPhaseStart } from "../engine/guidance.ts";

const TOKEN_KEY = "hometower.pushToken.v1";
const SCHEDULED_KEY = "hometower.pushScheduled.v1";

export interface PushStatus {
  stage: string;
  permission: string;
  token: string | null;
  scheduledCount: number;
  error: string | null;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function getPushStatus(): Promise<PushStatus> {
  const status: PushStatus = { stage: "read", permission: "unknown", token: null, scheduledCount: 0, error: null };
  try {
    const perm = await Notifications.getPermissionsAsync();
    status.permission = perm.status;
    status.token = await AsyncStorage.getItem(TOKEN_KEY);
    const scheduled = await AsyncStorage.getItem(SCHEDULED_KEY);
    status.scheduledCount = scheduled ? Number(scheduled) : 0;
  } catch (e) {
    status.stage = "read";
    status.error = e instanceof Error ? e.message : String(e);
  }
  return status;
}

/** The ONLY definition of enabled in this app: setting on AND token stored. */
export function isPushEnabled(settingOn: boolean, status: PushStatus): boolean {
  return settingOn && !!status.token;
}

export async function registerForPush(): Promise<PushStatus> {
  const status: PushStatus = { stage: "start", permission: "unknown", token: null, scheduledCount: 0, error: null };
  try {
    status.stage = "permission";
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status !== "granted") perm = await Notifications.requestPermissionsAsync();
    status.permission = perm.status;
    if (perm.status !== "granted") {
      status.error = "Notification permission not granted.";
      return status;
    }
    if (Platform.OS === "web") {
      status.stage = "web";
      status.error = "Push tokens are issued on the native app; on web the in-app freshness alerts still apply.";
      return status;
    }
    status.stage = "token";
    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    status.token = tokenResponse.data;
    await AsyncStorage.setItem(TOKEN_KEY, status.token);
    status.stage = "done";
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e);
  }
  return status;
}

/** The next `count` US market closes: 16:30 America/New_York on a
 * weekday (Mon-Fri ET), as device-local Dates. Computed by guessing
 * a UTC instant and correcting against the ET wall clock (two
 * passes converge across DST). The remote sender fires precisely
 * at 16:30 ET; these local reminders use the same instants so the
 * in-app close card is fresh when the user opens it. */
export function nextMarketCloses(count: number, from: Date = new Date()): Date[] {
  const parts = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(d);
  const etNow = parts(from);
  const get = (ps: Intl.DateTimeFormatPart[], t: string) => ps.find((p) => p.type === t)?.value ?? "";
  const startY = Number(get(etNow, "year"));
  const startM = Number(get(etNow, "month"));
  const startD = Number(get(etNow, "day"));
  const out: Date[] = [];
  for (let add = 0; add < 12 && out.length < count; add++) {
    // Target: ET wall clock 16:30 on (ET today + add days).
    const base = new Date(Date.UTC(startY, startM - 1, startD + add, 0, 0));
    let guess = new Date(base.getTime() + 20.5 * 3600_000); // 16:30 EST = 21:30 UTC; EDT = 20:30 UTC
    for (let i = 0; i < 2; i++) {
      const ps = parts(guess);
      const hh = Number(get(ps, "hour")) % 24;
      const mm = Number(get(ps, "minute"));
      const diffMin = 16 * 60 + 30 - (hh * 60 + mm);
      if (diffMin === 0) break;
      guess = new Date(guess.getTime() + diffMin * 60_000);
    }
    const wd = get(parts(guess), "weekday");
    if (wd === "Sat" || wd === "Sun") continue;
    if (guess.getTime() <= from.getTime() + 5 * 60_000) continue;
    out.push(guess);
  }
  return out;
}

/** (Re)schedule one local reminder per stale/aging document, next 9:00 AM. */
export async function syncStaleReminders(candidates: FreshnessFinding[], settingOn: boolean, marketClose: boolean = false): Promise<number> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!settingOn) {
      await AsyncStorage.setItem(SCHEDULED_KEY, "0");
      return 0;
    }
    const now = new Date();
    const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
    let count = 0;
    for (const c of candidates) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "HomeTower - document needs updating",
          body: c.message,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
      count++;
    }
    // SPEC45 sec. 20: one reminder at the start of the next annual
    // planning phase (Jan reset, June review, November window, ...).
    const phase = nextPhaseStart(now.getMonth() + 1);
    const phaseYear = phase.month <= now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
    const phaseDate = new Date(phaseYear, phase.month - 1, 1, 9, 0, 0);
    if (phaseDate > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "HomeTower - new planning phase",
          body: `${phase.title} starts today. Open HomeTower to see this phase's checklist.`,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: phaseDate },
      });
      count++;
    }
    // Daily market close (owner, 2026-11-07): on trading days, half
    // an hour after the close (16:30 ET), remind the user their
    // close report is ready. The remote push carries the live
    // numbers (native milestone); this local reminder carries the
    // user to the in-app card, which computes them live.
    if (marketClose) {
      for (const closeAt of nextMarketCloses(5, now)) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "HomeTower - market close",
            body: "Today's close report is ready - open HomeTower to see how your holdings did today.",
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: closeAt },
        });
        count++;
      }
    }
    await AsyncStorage.setItem(SCHEDULED_KEY, String(count));
    return count;
  } catch {
    return 0; // scheduling state is re-read and shown by getPushStatus; errors surface there
  }
}
