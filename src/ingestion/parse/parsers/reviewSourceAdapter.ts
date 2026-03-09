import { ingestionConfig } from "@/src/config/ingestion";
import { FetchResult, ParsedOutput, ParsedReview, SourceAdapter } from "@/src/core/types/ingestion";

function parseJsonReviews(fetchResult: FetchResult): ParsedReview[] {
  const payload = JSON.parse(fetchResult.body) as Array<Record<string, unknown>> | Record<string, unknown>;
  const records = Array.isArray(payload) ? payload : [payload];

  return records
    .map((record): ParsedReview => ({
      sourceUrl: fetchResult.url,
      externalId: typeof record.externalId === "string" ? record.externalId : null,
      title: String(record.title ?? "Untitled review"),
      body: String(record.body ?? ""),
      playerName: String(record.playerName ?? ""),
      versionName: typeof record.versionName === "string" ? record.versionName : null,
      eventName: typeof record.eventName === "string" ? record.eventName : null,
      ovr: typeof record.ovr === "number" ? record.ovr : null,
      position: typeof record.position === "string" ? record.position : null,
      rating: typeof record.rating === "number" ? record.rating : null,
      pros: Array.isArray(record.pros) ? record.pros.map(String) : [],
      cons: Array.isArray(record.cons) ? record.cons.map(String) : [],
      authorName: typeof record.authorName === "string" ? record.authorName : null,
      reviewKind: "editorial",
      publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : fetchResult.fetchedAt,
      metadata: record,
    }))
    .filter((review) => review.playerName.trim().length > 0 && review.body.trim().length > 0);
}

function parseHtmlReviews(fetchResult: FetchResult): ParsedReview[] {
  const matches = [...fetchResult.body.matchAll(/<article[^>]*data-player="([^"]+)"[^>]*data-ovr="(\d+)"[^>]*>.*?<h1>(.*?)<\/h1>.*?<p>(.*?)<\/p>/gis)];
  return matches.map((match, index) => ({
    sourceUrl: fetchResult.url,
    externalId: `${fetchResult.url}#review-${index}`,
    title: match[3],
    body: match[4],
    playerName: match[1],
    versionName: null,
    eventName: null,
    ovr: Number(match[2]),
    position: null,
    rating: null,
    pros: [],
    cons: [],
    authorName: null,
    reviewKind: "editorial",
    publishedAt: fetchResult.fetchedAt,
    metadata: {
      parser: "html-article",
    },
  }));
}

export const reviewSourceAdapter: SourceAdapter = {
  name: "example-review-source",
  pageType: "review",
  fetchMode: "api",
  async discoverUrls(context) {
    return ingestionConfig.reviewSourceSeeds.slice(0, context.maxUrls).map((url) => ({ url }));
  },
  async parsePage(fetchResult): Promise<ParsedOutput> {
    const reviews = fetchResult.body.trim().startsWith("{") || fetchResult.body.trim().startsWith("[")
      ? parseJsonReviews(fetchResult)
      : parseHtmlReviews(fetchResult);

    return {
      cards: [],
      reviews,
      mentions: [],
    };
  },
};
