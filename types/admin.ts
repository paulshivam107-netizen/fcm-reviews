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

export type AdminEventOptionsResponse = {
  items: string[];
  meta: {
    count: number;
  };
};

export type AdminPlayerMutationResponse = {
  success: boolean;
  item: AdminPlayerItem;
  refreshed: boolean;
  mergedFromPlayerId?: string | null;
};

export type AdminArchiveStaleResponse = {
  success: boolean;
  archivedCount: number;
  days: number;
  refreshed: boolean;
};

export type AdminManualReviewResponse = {
  success: boolean;
  submissionId: string;
  playerId: string;
  refreshed: boolean;
  message: string;
};

export type AdminPlayerMergePreviewPlayer = {
  id: string;
  playerName: string;
  baseOvr: number;
  basePosition: string;
  programPromo: string;
  isActive: boolean;
};

export type AdminPlayerMergePreviewCounts = {
  mentions: number;
  mentionConflicts: number;
  mentionsToMove: number;
  userReviewsTotal: number;
  userReviewsApproved: number;
  userReviewsPending: number;
  userReviewsRejected: number;
  aliasesTotal: number;
  aliasConflicts: number;
  aliasesToMove: number;
  eventLogsToMove: number;
};

export type AdminPlayerMergeTargetCounts = {
  mentions: number;
  userReviewsTotal: number;
};

export type AdminPlayerMergePreview = {
  sourcePlayer: AdminPlayerMergePreviewPlayer;
  targetPlayer: AdminPlayerMergePreviewPlayer;
  sourceCounts: AdminPlayerMergePreviewCounts;
  targetCounts: AdminPlayerMergeTargetCounts;
};

export type AdminPlayerMergePreviewResponse = {
  preview: AdminPlayerMergePreview;
};

export type AdminPlayerMergeExecuteSummary = {
  auditId: string;
  sourcePlayerId: string;
  targetPlayerId: string;
  movedMentionsCount: number;
  skippedMentionsCount: number;
  movedUserReviewsCount: number;
  movedAliasesCount: number;
  skippedAliasesCount: number;
  movedEventLogsCount: number;
};

export type AdminPlayerMergeExecuteResponse = {
  success: boolean;
  summary: AdminPlayerMergeExecuteSummary;
  refreshed: boolean;
};
