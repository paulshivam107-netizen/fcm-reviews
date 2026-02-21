export type PlayerTab = "attacker" | "midfielder" | "defender" | "goalkeeper";

export type PlayerInsightTerm = {
  text: string;
  count: number;
};

export type PlayerRow = {
  player_id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  mention_count: number;
  avg_sentiment_score: number | null;
  top_pros?: PlayerInsightTerm[];
  top_cons?: PlayerInsightTerm[];
  last_processed_at: string | null;
};

export type PlayersApiResponse = {
  items: PlayerRow[];
  meta: {
    tab: PlayerTab;
    query: string;
    requestedOvr: number | null;
    count: number;
  };
};
