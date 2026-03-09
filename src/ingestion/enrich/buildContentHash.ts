import { buildContentHash } from "@/src/core/utils/hash";

export function buildNormalizedContentHash(input: {
  title?: string | null;
  body: string;
  sourceName: string;
  sourceUrl?: string | null;
}) {
  return buildContentHash(input);
}
