import { createIngestionDbClient } from "@/src/core/db/client";
import { normalizeMention, NormalizedMention } from "@/src/ingestion/normalize/normalizeMention";
import { ParsedMention } from "@/src/core/types/ingestion";
import { resolveCardVersion } from "@/src/ingestion/resolve/resolveEntity";

export async function upsertMention(parsed: ParsedMention, sourceName: string) {
  const db = createIngestionDbClient();
  const normalized: NormalizedMention = normalizeMention(parsed, sourceName);
  const resolution = await resolveCardVersion({
    playerName: normalized.playerName,
    versionName: normalized.versionName,
    eventName: normalized.eventName,
    ovr: normalized.ovr,
    position: normalized.position,
  });

  const [mention] = await db.upsert<Array<{ id: string }>>({
    table: "community_mentions",
    values: {
      card_version_id: resolution.matchedCardVersionId,
      source_platform: normalized.sourcePlatform,
      source_community: normalized.sourceCommunity,
      source_url: normalized.sourceUrl,
      source_external_id: normalized.externalId,
      title: normalized.title,
      body: normalized.body,
      author_name: normalized.authorName,
      sentiment_score: normalized.sentimentScore,
      content_hash: normalized.contentHash,
      published_at: normalized.publishedAt,
      resolution_status: resolution.status,
      resolution_confidence: resolution.confidence,
      resolution_metadata: {
        matchedBy: resolution.matchedBy,
        candidate: resolution.candidate,
      },
      metadata: normalized.metadata,
    },
    onConflict: "content_hash",
  });

  return {
    mentionId: mention.id,
    cardVersionId: resolution.matchedCardVersionId,
    resolution,
  };
}
