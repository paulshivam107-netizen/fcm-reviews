import { NormalizedReview, ParsedReview } from "@/src/core/types/ingestion";
import { limitLength, normalizePosition, normalizeWhitespace, titleCase } from "@/src/core/utils/text";
import { buildNormalizedContentHash } from "@/src/ingestion/enrich/buildContentHash";

export function normalizeReview(parsed: ParsedReview, sourceName: string): NormalizedReview {
  return {
    title: limitLength(normalizeWhitespace(parsed.title), 240),
    body: normalizeWhitespace(parsed.body),
    playerName: titleCase(parsed.playerName),
    versionName: parsed.versionName ? titleCase(parsed.versionName) : null,
    eventName: parsed.eventName ? titleCase(parsed.eventName) : null,
    ovr: typeof parsed.ovr === "number" ? parsed.ovr : null,
    position: normalizePosition(parsed.position),
    rating: typeof parsed.rating === "number" ? parsed.rating : null,
    pros: parsed.pros ?? [],
    cons: parsed.cons ?? [],
    authorName: parsed.authorName ? normalizeWhitespace(parsed.authorName) : null,
    contentHash: buildNormalizedContentHash({
      title: parsed.title,
      body: parsed.body,
      sourceName,
      sourceUrl: parsed.sourceUrl,
    }),
    sourceName,
    sourceUrl: normalizeWhitespace(parsed.sourceUrl),
    externalId: parsed.externalId ? normalizeWhitespace(parsed.externalId) : null,
    publishedAt: parsed.publishedAt ?? null,
    reviewKind: parsed.reviewKind,
    metadata: parsed.metadata ?? {},
  };
}
