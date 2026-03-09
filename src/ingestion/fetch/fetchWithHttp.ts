import { ingestionConfig } from "@/src/config/ingestion";
import { FetchResult } from "@/src/core/types/ingestion";
import { nowIso } from "@/src/core/utils/time";

export async function fetchWithHttp(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ingestionConfig.defaultFetchTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "fcm-reviews-ingestion/1.0",
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const body = await response.text();
    return {
      url,
      status: response.status,
      ok: response.ok,
      fetchedAt: nowIso(),
      fetchMode: "http",
      mimeType: response.headers.get("content-type"),
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
