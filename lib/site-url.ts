const DEFAULT_SITE_URL = "https://fcm-reviews-production.up.railway.app";

export function getSiteUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, "");
}
