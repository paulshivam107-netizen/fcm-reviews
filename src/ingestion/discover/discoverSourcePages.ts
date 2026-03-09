import { createLogger } from "@/src/core/logging/logger";
import { DiscoveredUrl, SourceAdapter } from "@/src/core/types/ingestion";
import { nowIso } from "@/src/core/utils/time";
import { upsertSourcePage } from "@/src/ingestion/upsert/trackSourcePage";

export async function discoverSourcePages(adapter: SourceAdapter, maxUrls: number) {
  const logger = createLogger(`discover:${adapter.name}`);
  const discovered = await adapter.discoverUrls({
    nowIso: nowIso(),
    maxUrls,
  });

  const uniqueUrls = new Map<string, DiscoveredUrl>();
  for (const item of discovered) {
    uniqueUrls.set(item.url, item);
  }

  const pages = [...uniqueUrls.values()];
  logger.info("discovered source pages", {
    adapter: adapter.name,
    count: pages.length,
  });

  for (const page of pages) {
    await upsertSourcePage({
      sourceName: adapter.name,
      pageType: adapter.pageType,
      url: page.url,
      externalId: page.externalId ?? null,
      metadata: page.metadata ?? {},
    });
  }

  return pages;
}
