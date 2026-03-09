import { ingestionConfig } from "@/src/config/ingestion";
import { FetchResult, ParsedCard, ParsedOutput, SourceAdapter } from "@/src/core/types/ingestion";

function parseJsonCards(fetchResult: FetchResult): ParsedCard[] {
  const payload = JSON.parse(fetchResult.body) as Array<Record<string, unknown>> | Record<string, unknown>;
  const records = Array.isArray(payload) ? payload : [payload];

  return records
    .map((record) => ({
      sourceUrl: fetchResult.url,
      externalId: typeof record.externalId === "string" ? record.externalId : null,
      title: typeof record.title === "string" ? record.title : String(record.playerName ?? ""),
      body: typeof record.body === "string" ? record.body : JSON.stringify(record),
      playerName: String(record.playerName ?? ""),
      versionName: typeof record.versionName === "string" ? record.versionName : null,
      eventName: typeof record.eventName === "string" ? record.eventName : null,
      ovr: typeof record.ovr === "number" ? record.ovr : null,
      primaryPosition: typeof record.primaryPosition === "string" ? record.primaryPosition : null,
      altPositions: Array.isArray(record.altPositions) ? record.altPositions.map(String) : [],
      stats: typeof record.stats === "object" && record.stats ? (record.stats as Record<string, number>) : {},
      publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : fetchResult.fetchedAt,
      imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : null,
      metadata: record,
    }))
    .filter((card) => card.playerName.trim().length > 0);
}

function parseHtmlCards(fetchResult: FetchResult): ParsedCard[] {
  const matches = [...fetchResult.body.matchAll(/data-player-name="([^"]+)"[^>]*data-ovr="(\d+)"[^>]*data-position="([^"]+)"[^>]*data-version="([^"]*)"/g)];
  return matches.map((match, index) => ({
    sourceUrl: fetchResult.url,
    externalId: `${fetchResult.url}#card-${index}`,
    title: `${match[1]} ${match[4] || "Card"}`,
    body: match[0],
    playerName: match[1],
    versionName: match[4] || null,
    eventName: match[4] || null,
    ovr: Number(match[2]),
    primaryPosition: match[3],
    altPositions: [],
    stats: {},
    publishedAt: fetchResult.fetchedAt,
    imageUrl: null,
    metadata: {
      parser: "html-data-attribute",
    },
  }));
}

export const cardSourceAdapter: SourceAdapter = {
  name: "example-card-source",
  pageType: "card",
  fetchMode: "api",
  async discoverUrls(context) {
    return ingestionConfig.cardSourceSeeds.slice(0, context.maxUrls).map((url) => ({ url }));
  },
  async parsePage(fetchResult): Promise<ParsedOutput> {
    const cards = fetchResult.body.trim().startsWith("{") || fetchResult.body.trim().startsWith("[")
      ? parseJsonCards(fetchResult)
      : parseHtmlCards(fetchResult);

    return {
      cards,
      reviews: [],
      mentions: [],
    };
  },
};
