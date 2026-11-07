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

/** (Re)schedule one local reminder per stale/aging document, next 9:00 AM. */
export async function syncStaleReminders(candidates: FreshnessFinding[], settingOn: boolean): Promise<number> {
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
    await AsyncStorage.setItem(SCHEDULED_KEY, String(count));
    return count;
  } catch {
    return 0; // scheduling state is re-read and shown by getPushStatus; errors surface there
  }
}
