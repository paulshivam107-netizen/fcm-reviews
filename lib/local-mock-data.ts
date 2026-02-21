import { ParsedSearch } from "@/lib/search";
import { PlayerRow, PlayerTab } from "@/types/player";

export type LocalMockReviewSeed = {
  id: string;
  player_id: string;
  player_name: string;
  sentiment_score: number;
  played_position: string;
  mentioned_rank_text: string | null;
  pros: string[];
  cons: string[];
  note: string;
  submitted_username: string | null;
  submitted_username_type: "reddit" | "game" | null;
  submitted_at: string;
  status: "pending" | "approved";
};

export const LOCAL_MOCK_PLAYERS: PlayerRow[] = [
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a001",
    player_name: "Harry Kewell",
    base_ovr: 113,
    base_position: "LW",
    program_promo: "Glorious Era",
    mention_count: 14,
    avg_sentiment_score: 8.9,
    top_pros: [
      { text: "pace", count: 9 },
      { text: "dribbling", count: 7 },
      { text: "finesse shots", count: 6 },
    ],
    top_cons: [
      { text: "weak foot", count: 8 },
      { text: "stamina", count: 6 },
    ],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a002",
    player_name: "Lionel Messi",
    base_ovr: 117,
    base_position: "RW",
    program_promo: "TOTY",
    mention_count: 51,
    avg_sentiment_score: 9.3,
    top_pros: [
      { text: "dribbling", count: 34 },
      { text: "finesse shots", count: 30 },
    ],
    top_cons: [{ text: "physical", count: 8 }],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a003",
    player_name: "Rodri",
    base_ovr: 116,
    base_position: "CDM",
    program_promo: "UTOTY",
    mention_count: 38,
    avg_sentiment_score: 8.8,
    top_pros: [
      { text: "positioning", count: 22 },
      { text: "passing", count: 20 },
    ],
    top_cons: [{ text: "pace", count: 11 }],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a006",
    player_name: "Michael Essien",
    base_ovr: 116,
    base_position: "CDM",
    program_promo: "Icon",
    mention_count: 12,
    avg_sentiment_score: 3.6,
    top_pros: [{ text: "icon links", count: 3 }],
    top_cons: [
      { text: "high high workrate", count: 9 },
      { text: "underwhelming stats", count: 8 },
      { text: "3 star skill move", count: 7 },
    ],
    last_processed_at: "2026-02-21T01:10:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a004",
    player_name: "Virgil van Dijk",
    base_ovr: 118,
    base_position: "CB",
    program_promo: "TOTY",
    mention_count: 43,
    avg_sentiment_score: 9.1,
    top_pros: [
      { text: "physical", count: 31 },
      { text: "defending", count: 27 },
    ],
    top_cons: [{ text: "turning", count: 9 }],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a005",
    player_name: "Gianluigi Donnarumma",
    base_ovr: 116,
    base_position: "GK",
    program_promo: "TOTY",
    mention_count: 24,
    avg_sentiment_score: 8.5,
    top_pros: [{ text: "shot stopping", count: 16 }],
    top_cons: [{ text: "distribution", count: 8 }],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
];

export const LOCAL_MOCK_REVIEW_SEEDS: LocalMockReviewSeed[] = [
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1010",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a001",
    player_name: "Harry Kewell",
    sentiment_score: 9,
    played_position: "LW",
    mentioned_rank_text: "gold",
    pros: ["Pace", "Dribbling", "Finishing"],
    cons: ["Weak Foot", "Physical"],
    note:
      "Demo seed review: 113+5 with training 30. Recommended as super-sub cutting in from RW/RM. Very high pace and dribbling, strong right-foot finesse, weak 3* WF, and stamina drops around 70-80'.",
    submitted_username: "demo_reddit_user",
    submitted_username_type: "reddit",
    submitted_at: "2026-02-20T19:00:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1011",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a006",
    player_name: "Michael Essien",
    sentiment_score: 3.2,
    played_position: "CDM",
    mentioned_rank_text: null,
    pros: [],
    cons: ["Workrate", "Physical", "Dribbling"],
    note:
      "From Reddit screenshot: CDM with high-high workrate tends to be out of position in key defensive moments, overall stats felt underwhelming, and 3* skill moves are not useful if used as CM. Conclusion: among the weakest 116 Icon options.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:10:00.000Z",
    status: "approved",
  },
];

function isPlaceholderValue(value: string | undefined) {
  if (!value) return true;
  const normalized = value.trim();
  if (!normalized) return true;
  return (
    normalized.includes("YOUR_PROJECT") ||
    normalized.includes("YOUR_SUPABASE") ||
    normalized.includes("YOUR_")
  );
}

export function shouldUseLocalMockData(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined
) {
  const forceMock =
    String(process.env.USE_LOCAL_MOCK_DATA ?? "").toLowerCase() === "true";
  return forceMock || isPlaceholderValue(supabaseUrl) || isPlaceholderValue(supabaseKey);
}

export function queryLocalMockPlayers(args: {
  tab: PlayerTab;
  parsed: ParsedSearch;
  limit: number;
  positionGroups: Record<PlayerTab, string[]>;
}): PlayerRow[] {
  const { tab, parsed, limit, positionGroups } = args;
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;
  const allowedPositions = new Set(positionGroups[tab]);
  const query = parsed.nameQuery.trim().toLowerCase();

  let rows = LOCAL_MOCK_PLAYERS;

  if (!isOvrOnlyQuery) {
    rows = rows.filter((row) => allowedPositions.has(row.base_position));
  }

  if (parsed.requestedOvr !== null) {
    rows = rows.filter((row) => row.base_ovr === parsed.requestedOvr);
  }

  if (query) {
    rows = rows.filter((row) => row.player_name.toLowerCase().includes(query));
  }

  rows.sort((a, b) => {
    const scoreA = a.avg_sentiment_score ?? -1;
    const scoreB = b.avg_sentiment_score ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    if (a.mention_count !== b.mention_count) return b.mention_count - a.mention_count;
    return b.base_ovr - a.base_ovr;
  });

  return rows.slice(0, limit);
}
