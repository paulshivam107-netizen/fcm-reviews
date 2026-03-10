export type AdminImportPlayerCandidate = {
  playerId: string;
  playerName: string;
  baseOvr: number;
  basePosition: string;
  programPromo: string;
  matchConfidence: number;
};

export type AdminRedditImportPreview = {
  sourceMode: "url" | "text";
  sourceUrl: string | null;
  sourceSubreddit: string | null;
  sourceAuthor: string | null;
  sourcePublishedAt: string | null;
  sourceExternalId: string;
  title: string | null;
  body: string;
  playerCandidate: AdminImportPlayerCandidate | null;
  extractedPlayerName: string;
  extractedPlayerOvr: number | null;
  extractedEventName: string | null;
  extractedPlayedPosition: string | null;
  extractedRankText: string | null;
  extractedSentimentScore: number | null;
  extractedPros: string[];
  extractedCons: string[];
  extractedSummary: string | null;
  confidence: number;
  needsReview: boolean;
};

export type AdminRedditImportPreviewResponse = {
  preview: AdminRedditImportPreview;
};

export type AdminRedditImportPublishResponse = {
  success: boolean;
  playerId: string;
  sourceExternalId: string;
  refreshed: boolean;
  message: string;
};

export type RedditWatchlistItem = {
  id: string;
  playerId: string;
  playerName: string;
  baseOvr: number;
  basePosition: string;
  programPromo: string;
  searchTerms: string[];
  subreddits: string[];
  isActive: boolean;
  lastPolledAt: string | null;
  lastResultCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RedditWatchlistResponse = {
  items: RedditWatchlistItem[];
  meta: {
    count: number;
  };
};

export type RedditWatchlistMutationResponse = {
  success: boolean;
  item: RedditWatchlistItem;
};

export type RedditWatchlistRunResponse = {
  success: boolean;
  processedEntries: number;
  discoveredPosts: number;
  importedMentions: number;
  failedEntries: number;
  refreshed: boolean;
  mode: "admin" | "cron";
};
