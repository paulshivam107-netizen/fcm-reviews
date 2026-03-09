import { createIngestionDbClient } from "@/src/core/db/client";
import {
  ResolutionCandidate,
  ResolutionResult,
} from "@/src/core/types/ingestion";
import { diceCoefficient, exactOrNormalizedMatch } from "@/src/core/utils/fuzzy";
import { normalizeLookupText, normalizePosition } from "@/src/core/utils/text";

type CardVersionRow = {
  id: string;
  card_id: string;
  canonical_player_name: string;
  version_name: string;
  event_name: string | null;
  ovr: number | null;
  primary_position_snapshot: string | null;
};

type EntityAliasRow = {
  entity_type: string;
  entity_id: string;
  alias_normalized: string;
};

function scoreCandidate(input: {
  playerName: string;
  versionName: string | null;
  ovr: number | null;
  position: string | null;
  candidate: ResolutionCandidate;
}) {
  const playerScore = diceCoefficient(input.playerName, input.candidate.cardName);
  const versionScore = input.versionName
    ? Math.max(
        diceCoefficient(input.versionName, input.candidate.versionName),
        diceCoefficient(input.versionName, input.candidate.eventName)
      )
    : 0.5;
  const ovrScore =
    typeof input.ovr === "number" && typeof input.candidate.ovr === "number"
      ? Math.max(0, 1 - Math.min(Math.abs(input.ovr - input.candidate.ovr), 10) / 10)
      : 0.35;
  const positionScore = input.position && input.candidate.primaryPosition
    ? exactOrNormalizedMatch(input.position, input.candidate.primaryPosition)
      ? 1
      : 0
    : 0.35;

  return Number((playerScore * 0.55 + versionScore * 0.15 + ovrScore * 0.2 + positionScore * 0.1).toFixed(4));
}

export async function resolveCardVersion(input: {
  playerName: string;
  versionName?: string | null;
  eventName?: string | null;
  ovr?: number | null;
  position?: string | null;
}): Promise<ResolutionResult> {
  const db = createIngestionDbClient();
  const normalizedPlayerName = normalizeLookupText(input.playerName);
  const normalizedVersionName = normalizeLookupText(input.versionName ?? input.eventName);
  const normalizedPosition = normalizePosition(input.position);

  const aliasRows = await db.select<EntityAliasRow[]>({
    table: "entity_aliases",
    select: "entity_type,entity_id,alias_normalized",
    filters: {
      alias_normalized: `eq.${normalizedPlayerName}`,
    },
    limit: 10,
  });

  if (aliasRows.length > 0) {
    const aliasMatch = aliasRows.find((row) => row.entity_type === "card_version");
    if (aliasMatch) {
      const versionRows = await db.select<CardVersionRow[]>({
        table: "card_versions",
        select: "id,card_id,canonical_player_name,version_name,event_name,ovr,primary_position_snapshot",
        filters: { id: `eq.${aliasMatch.entity_id}` },
        limit: 1,
      });

      const candidateRow = versionRows[0];
      if (candidateRow) {
        return {
          status: "alias-match",
          confidence: 0.99,
          matchedCardVersionId: candidateRow.id,
          matchedCardId: candidateRow.card_id,
          matchedBy: "alias",
          candidate: {
            cardVersionId: candidateRow.id,
            cardId: candidateRow.card_id,
            cardName: candidateRow.canonical_player_name,
            versionName: candidateRow.version_name,
            eventName: candidateRow.event_name,
            ovr: candidateRow.ovr,
            primaryPosition: candidateRow.primary_position_snapshot,
            alias: normalizedPlayerName,
          },
        };
      }
    }
  }

  const filters: Record<string, string> = {};
  if (typeof input.ovr === "number") {
    filters.ovr = `eq.${input.ovr}`;
  }
  if (normalizedPosition) {
    filters.primary_position_snapshot = `eq.${normalizedPosition}`;
  }

  const rows = await db.select<CardVersionRow[]>({
    table: "card_versions",
    select: "id,card_id,canonical_player_name,version_name,event_name,ovr,primary_position_snapshot",
    filters,
    limit: 50,
  });

  const candidates: ResolutionCandidate[] = rows.map((row) => ({
    cardVersionId: row.id,
    cardId: row.card_id,
    cardName: row.canonical_player_name,
    versionName: row.version_name,
    eventName: row.event_name,
    ovr: row.ovr,
    primaryPosition: row.primary_position_snapshot,
    alias: null,
  }));

  let bestCandidate: ResolutionCandidate | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreCandidate({
      playerName: normalizedPlayerName,
      versionName: normalizedVersionName || null,
      ovr: typeof input.ovr === "number" ? input.ovr : null,
      position: normalizedPosition,
      candidate,
    });

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate && bestScore >= 0.9) {
    return {
      status: "matched",
      confidence: bestScore,
      matchedCardVersionId: bestCandidate.cardVersionId,
      matchedCardId: bestCandidate.cardId,
      matchedBy: "exact",
      candidate: bestCandidate,
    };
  }

  if (bestCandidate && bestScore >= 0.72) {
    return {
      status: "fuzzy-match",
      confidence: bestScore,
      matchedCardVersionId: bestCandidate.cardVersionId,
      matchedCardId: bestCandidate.cardId,
      matchedBy: "fuzzy",
      candidate: bestCandidate,
    };
  }

  return {
    status: "unresolved",
    confidence: bestScore,
    matchedCardVersionId: null,
    matchedCardId: null,
    matchedBy: "none",
    candidate: bestCandidate,
  };
}
