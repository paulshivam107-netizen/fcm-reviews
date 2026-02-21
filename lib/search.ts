export type ParsedSearch = {
  raw: string;
  nameQuery: string;
  requestedOvr: number | null;
};

export function parsePlayerSearch(input: string): ParsedSearch {
  const raw = input.trim().toLowerCase();
  const ovrOnlyPattern = /^([0-9]{2,3})$/;
  const ovrPattern = /^([0-9]{2,3})\s+(.+)$/;
  const ovrOnlyMatch = raw.match(ovrOnlyPattern);
  const match = raw.match(ovrPattern);

  if (ovrOnlyMatch) {
    const requestedOvr = Number.parseInt(ovrOnlyMatch[1], 10);
    return {
      raw,
      nameQuery: "",
      requestedOvr: Number.isFinite(requestedOvr) ? requestedOvr : null,
    };
  }

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
