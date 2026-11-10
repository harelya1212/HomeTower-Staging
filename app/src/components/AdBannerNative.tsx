// The NATIVE ad banner (ROUND 62, R62-10) - react-native-google-
// mobile-ads wired into the same strip the web placeholder uses.
// This module is only ever bundled into native builds (it is
// reached through AdBanner.native.tsx; the web export resolves
// AdBanner.tsx and never includes the ads library).
//
// Every ID comes from getAdIds() (src/ads/adsConfig.ts) - test
// IDs in development and until HomeTower's own AdMob app/units
// are issued. The COPPA configuration is applied before the SDK
// initializes (child-directed, under-age tag, rating G), and
// every request carries the non-personalized-only option.
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import mobileAds, { BannerAd, BannerAdSize, MaxAdContentRating } from "react-native-google-mobile-ads";
import { COPPA_REQUEST_OPTIONS, getAdIds } from "../ads/adsConfig.ts";

export const AD_BANNER_HEIGHT_NATIVE = 54;

let initStarted = false;
function initAdsOnce(): void {
  if (initStarted) return;
  initStarted = true;
  mobileAds()
    .setRequestConfiguration({
      // COPPA (standing product law): child-directed treatment,
      // the under-age-of-consent tag, and a G content ceiling on
      // every request the SDK makes.
      maxAdContentRating: MaxAdContentRating.G,
      tagForChildDirectedTreatment: true,
      tagForUnderAgeOfConsent: true,
    })
    .then(() => mobileAds().initialize())
    .catch(() => { /* ads are an enhancement; the app never blocks on them */ });
}

export default function AdBannerNative() {
  const [ready, setReady] = useState(false);
  const ids = getAdIds();
  useEffect(() => {
    initAdsOnce();
    setReady(true);
  }, []);
  return (
    <View style={styles.banner}>
      <Text style={styles.adLabel}>AD</Text>
      {ready ? (
        <BannerAd
          unitId={ids.banner}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ ...COPPA_REQUEST_OPTIONS }}
        />
      ) : (
        <Text style={styles.text}>HomeTower is free - supported by ads</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { height: AD_BANNER_HEIGHT_NATIVE, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, backgroundColor: "#0B2A4A" },
  adLabel: { fontSize: 10, fontWeight: "800", color: "#FEC72C", letterSpacing: 2, borderWidth: 1, borderColor: "#FEC72C", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  text: { fontSize: 13, fontWeight: "600", color: "#FFFFFF" },
});
