import { normalizeLookupText } from "@/src/core/utils/text";

function bigrams(value: string) {
  const normalized = normalizeLookupText(value).replace(/\s+/g, " ");
  if (normalized.length < 2) return new Set(normalized ? [normalized] : []);

  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

export function diceCoefficient(left: string | null | undefined, right: string | null | undefined) {
  const leftBigrams = bigrams(String(left ?? ""));
  const rightBigrams = bigrams(String(right ?? ""));

  if (!leftBigrams.size && !rightBigrams.size) return 1;
  if (!leftBigrams.size || !rightBigrams.size) return 0;

  let overlap = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) overlap += 1;
  }

  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

export function exactOrNormalizedMatch(left: string | null | undefined, right: string | null | undefined) {
  return normalizeLookupText(left) === normalizeLookupText(right);
}
