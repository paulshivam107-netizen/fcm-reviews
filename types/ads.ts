export type AdProvider = "none" | "adsense";
export type AdSlotKey = "top_banner" | "in_feed" | "footer_sticky";

export type AdSlotConfig = {
  enabled: boolean;
  slotId: string | null;
};

export type AdsRuntimeConfig = {
  enabled: boolean;
  provider: AdProvider;
  adsenseClientId: string | null;
  previewPlaceholders: boolean;
  slots: Record<AdSlotKey, AdSlotConfig>;
};

export type AdsConfigApiResponse = {
  config: AdsRuntimeConfig;
};
