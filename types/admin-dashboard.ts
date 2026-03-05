export type AdminDashboardSnapshot = {
  windowDays: number;
  uniqueVisitors24h: number;
  uniqueVisitorsWindow: number;
  searches24h: number;
  cardOpens24h: number;
  reviewSubmissions24h: number;
  reviewsPending: number;
  reviewsApproved24h: number;
  reviewsRejected24h: number;
  reviewApprovalRate24h: number | null;
  feedbackSubmissions24h: number;
  feedbackPending: number;
  feedbackReviewed24h: number;
  feedbackResolved24h: number;
  openFromSearchRatePct: number | null;
  reviewSubmitRatePct: number | null;
};

export type AdminDashboardResponse = {
  snapshot: AdminDashboardSnapshot;
  generatedAt: string;
};
