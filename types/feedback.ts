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
