export type ParsedSearch = {
  raw: string;
  nameQuery: string;
  requestedOvr: number | null;
};

export function parsePlayerSearch(input: string): ParsedSearch {
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) {
    return {
      raw: "",
      nameQuery: "",
      requestedOvr: null,
    };
  }

  const tokens = raw.split(" ");
  let ovrTokenIndex = -1;
  let requestedOvr: number | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!/^\d{1,3}$/.test(token)) continue;
    const parsed = Number.parseInt(token, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 130) continue;
    requestedOvr = parsed;
    ovrTokenIndex = index;
    break;
  }

  const nameQuery =
    ovrTokenIndex >= 0
      ? tokens.filter((_, idx) => idx !== ovrTokenIndex).join(" ").trim()
      : raw;

  return {
    raw,
    nameQuery,
    requestedOvr,
  };
}
