import { createIngestionDbClient } from "@/src/core/db/client";
import { sha256 } from "@/src/core/utils/hash";

export async function upsertSourcePage(input: {
  sourceName: string;
  pageType: string;
  url: string;
  externalId: string | null;
  metadata: Record<string, unknown>;
}) {
  const db = createIngestionDbClient();
  const [row] = await db.upsert<Array<{ id: string }>>({
    table: "source_pages",
    values: {
      source_name: input.sourceName,
      page_type: input.pageType,
      url: input.url,
      url_hash: sha256(input.url),
      source_external_id: input.externalId,
      last_discovered_at: new Date().toISOString(),
      metadata: input.metadata,
    },
    onConflict: "url_hash",
  });

  return row;
}
