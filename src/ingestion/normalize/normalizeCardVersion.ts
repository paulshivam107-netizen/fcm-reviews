import { ParsedCard, NormalizedCardVersion } from "@/src/core/types/ingestion";
import { buildNormalizedContentHash } from "@/src/ingestion/enrich/buildContentHash";
import {
  ensureStringArray,
  normalizePosition,
  normalizeWhitespace,
  slugify,
  titleCase,
} from "@/src/core/utils/text";

export function normalizeCardVersion(parsed: ParsedCard, sourceName: string): NormalizedCardVersion {
  const canonicalPlayerName = titleCase(parsed.playerName);
  const versionName = titleCase(parsed.versionName ?? parsed.eventName ?? "Base");
  const eventName = parsed.eventName ? titleCase(parsed.eventName) : null;

  return {
    canonicalPlayerName,
    canonicalPlayerSlug: slugify(canonicalPlayerName),
    versionName,
    versionSlug: slugify(versionName),
    eventName,
    ovr: typeof parsed.ovr === "number" ? parsed.ovr : null,
    primaryPosition: normalizePosition(parsed.primaryPosition),
    altPositions: ensureStringArray(parsed.altPositions).map((value) => normalizePosition(value)).filter((value): value is string => Boolean(value)),
    stats: parsed.stats ?? {},
    imageUrl: parsed.imageUrl ? normalizeWhitespace(parsed.imageUrl) : null,
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
    metadata: parsed.metadata ?? {},
  };
}
