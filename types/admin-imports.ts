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
  ovrNormalization:
    | {
        displayOvr: number;
        normalizedBaseOvr: number;
        currentMaxBaseOvr: number;
        maxRankOvrBoost: number;
      }
    | null;
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

export type RedditImportSettings = {
  currentMaxBaseOvr: number;
  maxRankOvrBoost: number;
};

export type RedditImportSettingsResponse = {
  settings: RedditImportSettings;
};

export type AdminRedditImportPublishResponse = {
  success: boolean;
  playerId: string;
  sourceExternalId: string;
  refreshed: boolean;
  message: string;
};

export type AdminRedditImportQueueItem = {
  id: string;
  status: "pending" | "approved" | "rejected";
  sourceMode: "url" | "text";
  sourceUrl: string | null;
  sourceSubreddit: string | null;
  sourceAuthor: string | null;
  sourcePublishedAt: string | null;
  sourceExternalId: string;
  title: string | null;
  body: string;
  playerId: string | null;
  playerName: string;
  playerOvr: number;
  eventName: string | null;
  playedPosition: string;
  mentionedRankText: string | null;
  sentimentScore: number;
  pros: string[];
  cons: string[];
  summary: string | null;
  confidence: number;
  needsReview: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
  publishedPlayerId: string | null;
  refreshed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminRedditImportQueueResponse = {
  items: AdminRedditImportQueueItem[];
  meta: {
    count: number;
    status: "pending" | "approved" | "rejected";
  };
};

export type AdminRedditImportQueueMutationResponse = {
  success: boolean;
  item: AdminRedditImportQueueItem;
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

export type RedditWatchlistRunHistoryItem = {
  id: string;
  status: "running" | "completed" | "partial" | "failed";
  subreddits: string[];
  rawCommentsCount: number;
  processedMentionsCount: number;
  insertedMentionsCount: number;
  errorCount: number;
  errorLog: string | null;
  pullStartedAt: string | null;
  pullFinishedAt: string | null;
  createdAt: string;
};

export type RedditWatchlistRunHistoryResponse = {
  items: RedditWatchlistRunHistoryItem[];
  meta: {
    count: number;
  };
};
