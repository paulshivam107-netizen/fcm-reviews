import { createHash } from "node:crypto";
import { normalizeLookupText } from "@/src/core/utils/text";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildContentHash(input: {
  title?: string | null;
  body: string;
  sourceName: string;
  sourceUrl?: string | null;
}) {
  const normalized = [
    normalizeLookupText(input.title),
    normalizeLookupText(input.body),
    normalizeLookupText(input.sourceName),
    normalizeLookupText(input.sourceUrl),
  ].join("\n");

  return sha256(normalized);
}
