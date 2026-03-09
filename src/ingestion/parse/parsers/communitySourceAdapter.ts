import { ingestionConfig } from "@/src/config/ingestion";
import { FetchResult, ParsedMention, ParsedOutput, SourceAdapter } from "@/src/core/types/ingestion";

function parseJsonMentions(fetchResult: FetchResult): ParsedMention[] {
  const payload = JSON.parse(fetchResult.body) as Array<Record<string, unknown>> | Record<string, unknown>;
  const records = Array.isArray(payload) ? payload : [payload];

  return records
    .map((record) => ({
      sourceUrl: fetchResult.url,
      externalId: typeof record.externalId === "string" ? record.externalId : null,
      title: typeof record.title === "string" ? record.title : null,
      body: String(record.body ?? ""),
      sourcePlatform: String(record.sourcePlatform ?? "community"),
      sourceCommunity: typeof record.sourceCommunity === "string" ? record.sourceCommunity : null,
      playerName: String(record.playerName ?? ""),
      versionName: typeof record.versionName === "string" ? record.versionName : null,
      eventName: typeof record.eventName === "string" ? record.eventName : null,
      ovr: typeof record.ovr === "number" ? record.ovr : null,
      position: typeof record.position === "string" ? record.position : null,
      sentimentScore: typeof record.sentimentScore === "number" ? record.sentimentScore : null,
      pros: Array.isArray(record.pros) ? record.pros.map(String) : [],
      cons: Array.isArray(record.cons) ? record.cons.map(String) : [],
      authorName: typeof record.authorName === "string" ? record.authorName : null,
      publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : fetchResult.fetchedAt,
      metadata: record,
    }))
    .filter((mention) => mention.playerName.trim().length > 0 && mention.body.trim().length > 0);
}

function parseHtmlMentions(fetchResult: FetchResult): ParsedMention[] {
  const matches = [...fetchResult.body.matchAll(/<li[^>]*data-player="([^"]+)"[^>]*data-platform="([^"]+)"[^>]*>(.*?)<\/li>/gis)];
  return matches.map((match, index) => ({
    sourceUrl: fetchResult.url,
    externalId: `${fetchResult.url}#mention-${index}`,
    title: null,
    body: match[3],
    sourcePlatform: match[2],
    sourceCommunity: null,
    playerName: match[1],
    versionName: null,
    eventName: null,
    ovr: null,
    position: null,
    sentimentScore: null,
    pros: [],
    cons: [],
    authorName: null,
    publishedAt: fetchResult.fetchedAt,
    metadata: {
      parser: "html-list-item",
    },
  }));
}

export const communitySourceAdapter: SourceAdapter = {
  name: "example-community-source",
  pageType: "community",
  fetchMode: "api",
  async discoverUrls(context) {
    return ingestionConfig.communitySourceSeeds.slice(0, context.maxUrls).map((url) => ({ url }));
  },
  async parsePage(fetchResult): Promise<ParsedOutput> {
    const mentions = fetchResult.body.trim().startsWith("{") || fetchResult.body.trim().startsWith("[")
      ? parseJsonMentions(fetchResult)
      : parseHtmlMentions(fetchResult);

    return {
      cards: [],
      reviews: [],
      mentions,
    };
  },
};
