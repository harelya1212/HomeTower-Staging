// Native platform entry for the ad banner (ROUND 62, R62-10):
// Metro resolves this file instead of AdBanner.tsx on iOS and
// Android, so native builds render the real AdMob banner while
// the web export keeps the placeholder strip and never bundles
// the ads library. AD_BANNER_HEIGHT is re-exported because
// App.tsx imports it alongside the component.
import AdBannerNative from "./AdBannerNative.tsx";

export const AD_BANNER_HEIGHT = 54;
export default AdBannerNative;
