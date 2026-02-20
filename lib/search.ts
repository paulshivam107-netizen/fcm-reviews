export type ParsedSearch = {
  raw: string;
  nameQuery: string;
  requestedOvr: number | null;
};

export function parsePlayerSearch(input: string): ParsedSearch {
  const raw = input.trim().toLowerCase();
  const ovrPattern = /^([0-9]{2,3})\s+(.+)$/;
  const match = raw.match(ovrPattern);

  if (!match) {
    return {
      raw,
      nameQuery: raw,
      requestedOvr: null,
    };
  }

  const requestedOvr = Number.parseInt(match[1], 10);
  return {
    raw,
    nameQuery: match[2].trim(),
    requestedOvr: Number.isFinite(requestedOvr) ? requestedOvr : null,
  };
}
