export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeLookupText(value: string | null | undefined) {
  return normalizeWhitespace(String(value ?? "")).toLowerCase();
}

export function slugify(value: string | null | undefined) {
  return normalizeLookupText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function titleCase(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value ?? "")).toLowerCase();
  if (!normalized) return "";

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ensureStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeWhitespace(String(entry)))
    .filter(Boolean);
}

export function normalizePosition(value: string | null | undefined) {
  const normalized = normalizeLookupText(value).replace(/[^a-z]/g, "").toUpperCase();
  if (!normalized) return null;
  if (normalized.length < 2 || normalized.length > 4) return null;
  return normalized;
}

export function limitLength(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trim();
}
