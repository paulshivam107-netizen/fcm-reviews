export type AdminPlayerItem = {
  playerId: string;
  playerName: string;
  baseOvr: number;
  basePosition: string;
  programPromo: string;
  isActive: boolean;
  mentionCount: number;
  avgSentimentScore: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminPlayersListResponse = {
  items: AdminPlayerItem[];
  meta: {
    count: number;
    query: string;
    includeInactive: boolean;
  };
};

export type AdminPlayerMutationResponse = {
  success: boolean;
  item: AdminPlayerItem;
  refreshed: boolean;
};

export type AdminArchiveStaleResponse = {
  success: boolean;
  archivedCount: number;
  days: number;
  refreshed: boolean;
};
