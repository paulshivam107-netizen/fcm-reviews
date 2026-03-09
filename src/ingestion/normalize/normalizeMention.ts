import { ParsedMention } from "@/src/core/types/ingestion";
import { buildNormalizedContentHash } from "@/src/ingestion/enrich/buildContentHash";
import { normalizePosition, normalizeWhitespace, titleCase } from "@/src/core/utils/text";

export type NormalizedMention = {
  title: string | null;
  body: string;
  sourcePlatform: string;
  sourceCommunity: string | null;
  playerName: string;
  versionName: string | null;
  eventName: string | null;
  ovr: number | null;
  position: string | null;
  sentimentScore: number | null;
  pros: string[];
  cons: string[];
  authorName: string | null;
  contentHash: string;
  sourceUrl: string;
  externalId: string | null;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
};

export function normalizeMention(parsed: ParsedMention, sourceName: string): NormalizedMention {
  return {
    title: parsed.title ? normalizeWhitespace(parsed.title) : null,
    body: normalizeWhitespace(parsed.body),
    sourcePlatform: normalizeWhitespace(parsed.sourcePlatform).toLowerCase(),
    sourceCommunity: parsed.sourceCommunity ? normalizeWhitespace(parsed.sourceCommunity) : null,
    playerName: titleCase(parsed.playerName),
    versionName: parsed.versionName ? titleCase(parsed.versionName) : null,
    eventName: parsed.eventName ? titleCase(parsed.eventName) : null,
    ovr: typeof parsed.ovr === "number" ? parsed.ovr : null,
    position: normalizePosition(parsed.position),
    sentimentScore: typeof parsed.sentimentScore === "number" ? parsed.sentimentScore : null,
    pros: parsed.pros ?? [],
    cons: parsed.cons ?? [],
    authorName: parsed.authorName ? normalizeWhitespace(parsed.authorName) : null,
    contentHash: buildNormalizedContentHash({
      title: parsed.title,
      body: parsed.body,
      sourceName,
      sourceUrl: parsed.sourceUrl,
    }),
    sourceUrl: normalizeWhitespace(parsed.sourceUrl),
    externalId: parsed.externalId ? normalizeWhitespace(parsed.externalId) : null,
    publishedAt: parsed.publishedAt ?? null,
    metadata: parsed.metadata ?? {},
  };
}
