import { createIngestionDbClient } from "@/src/core/db/client";
import { NormalizedReview } from "@/src/core/types/ingestion";
import { resolveCardVersion } from "@/src/ingestion/resolve/resolveEntity";

export async function upsertReview(normalized: NormalizedReview) {
  const db = createIngestionDbClient();
  const resolution = await resolveCardVersion({
    playerName: normalized.playerName,
    versionName: normalized.versionName,
    eventName: normalized.eventName,
    ovr: normalized.ovr,
    position: normalized.position,
  });

  const [review] = await db.upsert<Array<{ id: string }>>({
    table: "reviews",
    values: {
      card_version_id: resolution.matchedCardVersionId,
      source_name: normalized.sourceName,
      source_url: normalized.sourceUrl,
      source_external_id: normalized.externalId,
      review_kind: normalized.reviewKind,
      title: normalized.title,
      body: normalized.body,
      author_name: normalized.authorName,
      rating: normalized.rating,
      content_hash: normalized.contentHash,
      published_at: normalized.publishedAt,
      resolution_status: resolution.status,
      resolution_confidence: resolution.confidence,
      resolution_metadata: {
        matchedBy: resolution.matchedBy,
        candidate: resolution.candidate,
        playerName: normalized.playerName,
        versionName: normalized.versionName,
        ovr: normalized.ovr,
        position: normalized.position,
      },
      metadata: normalized.metadata,
    },
    onConflict: "content_hash",
  });

  const reviewPoints = [
    ...normalized.pros.map((text, index) => ({
      review_id: review.id,
      point_type: "pro",
      point_text: text,
      point_text_normalized: text.toLowerCase(),
      sort_order: index,
    })),
    ...normalized.cons.map((text, index) => ({
      review_id: review.id,
      point_type: "con",
      point_text: text,
      point_text_normalized: text.toLowerCase(),
      sort_order: normalized.pros.length + index,
    })),
  ];

  if (reviewPoints.length > 0) {
    await db.upsert({
      table: "review_points",
      values: reviewPoints,
      onConflict: "review_id,point_type,point_text_normalized",
    });
  }

  return {
    reviewId: review.id,
    cardVersionId: resolution.matchedCardVersionId,
    resolution,
  };
}
