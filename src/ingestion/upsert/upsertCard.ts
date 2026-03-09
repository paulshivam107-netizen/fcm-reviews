import { createIngestionDbClient } from "@/src/core/db/client";
import { NormalizedCardVersion } from "@/src/core/types/ingestion";

function buildCardVersionDedupeKey(input: NormalizedCardVersion) {
  return [
    input.canonicalPlayerSlug,
    input.versionSlug || "base",
    input.ovr ?? "na",
    input.primaryPosition ?? "na",
  ].join(":");
}

export async function upsertCard(normalized: NormalizedCardVersion) {
  const db = createIngestionDbClient();

  const [card] = await db.upsert<Array<{ id: string }>>({
    table: "cards",
    values: {
      canonical_name: normalized.canonicalPlayerName,
      canonical_slug: normalized.canonicalPlayerSlug,
      primary_position: normalized.primaryPosition,
      metadata: normalized.metadata,
    },
    onConflict: "canonical_slug",
  });

  const dedupeKey = buildCardVersionDedupeKey(normalized);
  const [cardVersion] = await db.upsert<Array<{ id: string }>>({
    table: "card_versions",
    values: {
      card_id: card.id,
      dedupe_key: dedupeKey,
      canonical_player_name: normalized.canonicalPlayerName,
      version_name: normalized.versionName,
      version_slug: normalized.versionSlug,
      event_name: normalized.eventName,
      ovr: normalized.ovr,
      primary_position_snapshot: normalized.primaryPosition,
      alt_positions: normalized.altPositions,
      image_url: normalized.imageUrl,
      source_name: normalized.sourceName,
      source_url: normalized.sourceUrl,
      source_external_id: normalized.externalId,
      source_content_hash: normalized.contentHash,
      published_at: normalized.publishedAt,
      metadata: normalized.metadata,
    },
    onConflict: "dedupe_key",
  });

  if (Object.keys(normalized.stats).length > 0) {
    await db.upsert({
      table: "card_stats",
      values: {
        card_version_id: cardVersion.id,
        stat_block: normalized.stats,
        source_name: normalized.sourceName,
        source_url: normalized.sourceUrl,
      },
      onConflict: "card_version_id",
    });
  }

  return {
    cardId: card.id,
    cardVersionId: cardVersion.id,
    dedupeKey,
  };
}
