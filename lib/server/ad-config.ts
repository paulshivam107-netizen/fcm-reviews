import { AdsRuntimeConfig, AdProvider } from "@/types/ads";

function parseBool(raw: string | undefined, fallback = false) {
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function normalizeProvider(raw: string | undefined): AdProvider {
  const normalized = String(raw ?? "none").trim().toLowerCase();
  if (normalized === "adsense") return "adsense";
  return "none";
}

function normalizeSlotId(raw: string | undefined) {
  const value = String(raw ?? "").trim();
  return value.length ? value : null;
}

function normalizeClientId(raw: string | undefined) {
  const value = String(raw ?? "").trim();
  return value.length ? value : null;
}

export function getAdsRuntimeConfig(): AdsRuntimeConfig {
  const provider = normalizeProvider(process.env.AD_PROVIDER);
  const enabled = parseBool(process.env.ADS_ENABLED, false);
  const previewPlaceholders = parseBool(
    process.env.NEXT_PUBLIC_ENABLE_AD_SLOTS,
    false
  );

  const adsenseClientId = normalizeClientId(
    process.env.ADSENSE_CLIENT_ID ?? process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID
  );
  const topBannerSlotId = normalizeSlotId(process.env.ADSENSE_SLOT_TOP_BANNER);
  const inFeedSlotId = normalizeSlotId(process.env.ADSENSE_SLOT_IN_FEED);
  const footerStickySlotId = normalizeSlotId(
    process.env.ADSENSE_SLOT_FOOTER_STICKY
  );

  const canServeLiveAds =
    enabled && provider === "adsense" && Boolean(adsenseClientId);

  return {
    enabled: canServeLiveAds,
    provider: canServeLiveAds ? "adsense" : "none",
    adsenseClientId: canServeLiveAds ? adsenseClientId : null,
    previewPlaceholders,
    slots: {
      top_banner: {
        enabled: canServeLiveAds && Boolean(topBannerSlotId),
        slotId: topBannerSlotId,
      },
      in_feed: {
        enabled: canServeLiveAds && Boolean(inFeedSlotId),
        slotId: inFeedSlotId,
      },
      footer_sticky: {
        enabled: canServeLiveAds && Boolean(footerStickySlotId),
        slotId: footerStickySlotId,
      },
    },
  };
}
