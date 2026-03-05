export type UserFeedbackCategory =
  | "review_feedback"
  | "general_feedback"
  | "improvement_suggestion";

export type FeedbackSubmissionRequest = {
  category: UserFeedbackCategory | string;
  message: string;
  contact?: string | null;
  honeypot?: string | null;
  captchaToken?: string | null;
};

export type FeedbackSubmissionResponse = {
  success: boolean;
  status: "pending";
  submissionId: string;
  message: string;
};

export type FeedbackModerationStatus = "pending" | "reviewed" | "resolved";

export type AdminFeedbackQueueItem = {
  submissionId: string;
  category: UserFeedbackCategory;
  message: string;
  contact: string | null;
  status: FeedbackModerationStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export type AdminFeedbackQueueResponse = {
  items: AdminFeedbackQueueItem[];
  meta: {
    status: FeedbackModerationStatus;
    count: number;
  };
};

export type AdminFeedbackModerationResponse = {
  success: boolean;
  status: FeedbackModerationStatus;
};
