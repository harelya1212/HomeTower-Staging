// HomeTower AdMob configuration (ROUND 62, R62-10 - native ads,
// step 17). AdMob is approved and active for the publisher
// pub-6432783585572611 (2026-11-09).
//
// THE RULE (the owner's, verbatim in effect): every ad ID in
// HomeTower comes from getAdIds() in this file - no ad ID is
// embedded anywhere else. Development and staging builds use
// Google's public TEST IDs automatically (via __DEV__); real IDs
// are used by production builds only.
//
// HomeTower's OWN real IDs do not exist yet: the HomeTower app
// still has to be created in the AdMob console (APP PAYMENTS
// flow - the owner creates it and issues the App IDs and ad unit
// IDs). Until they are pasted into PRODUCTION_IDS below, every
// build - production included - falls back to the test IDs, so
// nothing can accidentally serve another app's units. (TReps'
// IDs belong to TReps and are NEVER used here: a separate app,
// a separate AdMob app entry, separate units.)
//
// COPPA / trust flags (standing product law): every ad request
// is child-directed, non-personalized, max content rating G.
// COPPA_REQUEST_CONFIGURATION is applied once at SDK init
// (AdBanner.native.tsx); COPPA_REQUEST_OPTIONS rides on every
// individual request.
import { Platform } from "react-native";

export const ADMOB_PUBLISHER_ID = "pub-6432783585572611";

/** Google's public test IDs (documented by Google for exactly
 * this purpose - they can never serve a real advertiser or earn
 * revenue). */
const TEST_IDS = {
  appIdAndroid: "ca-app-pub-3940256099942544~3347511713",
  appIdIos: "ca-app-pub-3940256099942544~1458002511",
  bannerAndroid: "ca-app-pub-3940256099942544/6300978111",
  bannerIos: "ca-app-pub-3940256099942544/2934735716",
  interstitialAndroid: "ca-app-pub-3940256099942544/1033173712",
  interstitialIos: "ca-app-pub-3940256099942544/4411468910",
};

/** HomeTower's real IDs - ALL EMPTY until the AdMob console step
 * issues them (missing: the HomeTower AdMob App IDs for Android
 * and iOS, and the banner + interstitial unit IDs for each
 * platform). Paste them here when issued; production builds pick
 * them up automatically - no other file changes. */
const PRODUCTION_IDS = {
  appIdAndroid: "",
  appIdIos: "",
  bannerAndroid: "",
  bannerIos: "",
  interstitialAndroid: "",
  interstitialIos: "",
};

export interface AdIds {
  appId: string;
  banner: string;
  interstitial: string;
  /** True when test IDs are in effect (dev build, or the real
   * HomeTower IDs have not been issued yet). */
  usingTestIds: boolean;
}

/** The single consumer path for ad IDs. Test IDs whenever the
 * build is a development build OR the real IDs are not issued
 * yet; real IDs only in a production build that has them. */
export function getAdIds(): AdIds {
  const prodReady = PRODUCTION_IDS.appIdAndroid !== "" && PRODUCTION_IDS.appIdIos !== "";
  const useProd = !__DEV__ && prodReady;
  const ids = useProd ? PRODUCTION_IDS : TEST_IDS;
  const ios = Platform.OS === "ios";
  return {
    appId: ios ? ids.appIdIos : ids.appIdAndroid,
    banner: ios ? ids.bannerIos : ids.bannerAndroid,
    interstitial: ios ? ids.interstitialIos : ids.interstitialAndroid,
    usingTestIds: !useProd,
  };
}

/** The App IDs the app.json plugin config carries (they must be
 * present at build time, before any JS runs - so app.json names
 * the test IDs until the real ones exist; getAdIds() above is
 * the runtime source for unit IDs). */
export const APP_ID_ANDROID = TEST_IDS.appIdAndroid;
export const APP_ID_IOS = TEST_IDS.appIdIos;

/** COPPA configuration for the SDK (applied once at init):
 * child-directed treatment on, under-age-of-consent tag on,
 * max ad content rating G. String values mirror the library's
 * MaxAdContentRating enum ("G") without importing the native
 * module into shared code. */
export const COPPA_REQUEST_CONFIGURATION = {
  maxAdContentRating: "G",
  tagForChildDirectedTreatment: true,
  tagForUnderAgeOfConsent: true,
} as const;

/** COPPA options riding on EVERY ad request: non-personalized
 * ads only. No ad request in HomeTower is ever built without
 * these. */
export const COPPA_REQUEST_OPTIONS = {
  requestNonPersonalizedAdsOnly: true,
} as const;
