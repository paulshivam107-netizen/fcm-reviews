export type SubmittedUsernameType = "reddit" | "game";

export type ReviewSubmissionRequest = {
  playerId: string;
  sentimentScore: number;
  playedPosition: string;
  mentionedRankText?: string | null;
  pros?: string[];
  cons?: string[];
  note?: string;
  submittedUsername?: string | null;
  submittedUsernameType?: SubmittedUsernameType | null;
};

export type ReviewSubmissionResponse = {
  success: boolean;
  status: "approved" | "pending";
  submissionId: string;
  refreshed: boolean;
  message: string;
};

export type PlayerReviewFeedItem = {
  id: string;
  sourcePlatform: "reddit" | "user";
  sourceLabel: string;
  sourceUrl: string | null;
  sentimentScore: number;
  playedPosition: string | null;
  mentionedRankText: string | null;
  pros: string[];
  cons: string[];
  summary: string | null;
  submittedAt: string;
};

export type PlayerReviewsApiResponse = {
  items: PlayerReviewFeedItem[];
  meta: {
    playerId: string;
    count: number;
  };
};

export type ModerationStatus = "pending" | "approved" | "rejected";

export type AdminReviewQueueItem = {
  submissionId: string;
  playerId: string;
  playerName: string;
  playerOvr: number;
  playerPosition: string;
  sentimentScore: number;
  playedPosition: string;
  mentionedRankText: string | null;
  pros: string[];
  cons: string[];
  note: string | null;
  submittedUsername: string | null;
  submittedUsernameType: SubmittedUsernameType | null;
  status: ModerationStatus;
  submittedAt: string;
};

export type AdminReviewQueueResponse = {
  items: AdminReviewQueueItem[];
  meta: {
    status: ModerationStatus;
    count: number;
  };
};
