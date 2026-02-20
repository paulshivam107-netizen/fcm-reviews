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
