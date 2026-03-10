"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AdminReviewQueueItem,
  AdminReviewQueueResponse,
  ModerationStatus,
} from "@/types/review";
import {
  AdminFeedbackQueueItem,
  AdminFeedbackQueueResponse,
  FeedbackModerationStatus,
  UserFeedbackCategory,
} from "@/types/feedback";
import {
  AdminDashboardResponse,
  AdminDashboardSnapshot,
} from "@/types/admin-dashboard";

type FetchState = "idle" | "loading" | "success" | "error";
type AuthState = "checking" | "authenticated" | "unauthenticated";
type ReviewActionState = "approve" | "reject" | null;
type FeedbackActionState = FeedbackModerationStatus | null;
type QueueType = "reviews" | "feedback";

const REVIEW_STATUS_TABS: ModerationStatus[] = ["pending", "approved", "rejected"];
const FEEDBACK_STATUS_TABS: FeedbackModerationStatus[] = [
  "pending",
  "reviewed",
  "resolved",
];

function formatWhen(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function reviewStatusClass(status: ModerationStatus) {
  if (status === "approved") {
    return "border-lime-300/40 bg-lime-300/12 text-lime-100";
  }
  if (status === "rejected") {
    return "border-rose-300/40 bg-rose-300/12 text-rose-100";
  }
  return "border-amber-300/40 bg-amber-300/12 text-amber-100";
}

function feedbackStatusClass(status: FeedbackModerationStatus) {
  if (status === "resolved") {
    return "border-lime-300/40 bg-lime-300/12 text-lime-100";
  }
  if (status === "reviewed") {
    return "border-cyan-300/40 bg-cyan-300/12 text-cyan-100";
  }
  return "border-amber-300/40 bg-amber-300/12 text-amber-100";
}

function feedbackCategoryLabel(category: UserFeedbackCategory) {
  if (category === "review_feedback") return "Review Feedback";
  if (category === "improvement_suggestion") return "Suggestion";
  return "General Feedback";
}

function feedbackCategoryHint(category: UserFeedbackCategory) {
  if (category === "review_feedback") {
    return "Review quality, score quality, and card-summary feedback.";
  }
  if (category === "improvement_suggestion") {
    return "Feature request or roadmap suggestion.";
  }
  return "General UI, performance, or product issue.";
}

function formatRate(value: number | null) {
  if (value === null || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

export default function AdminModerationPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [queueType, setQueueType] = useState<QueueType>("reviews");
  const [reviewStatusFilter, setReviewStatusFilter] =
    useState<ModerationStatus>("pending");
  const [feedbackStatusFilter, setFeedbackStatusFilter] =
    useState<FeedbackModerationStatus>("pending");

  const [reviewRows, setReviewRows] = useState<AdminReviewQueueItem[]>([]);
  const [feedbackRows, setFeedbackRows] = useState<AdminFeedbackQueueItem[]>([]);
  const [reviewState, setReviewState] = useState<FetchState>("idle");
  const [feedbackState, setFeedbackState] = useState<FetchState>("idle");
  const [dashboardState, setDashboardState] = useState<FetchState>("idle");
  const [dashboard, setDashboard] = useState<AdminDashboardSnapshot | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [reviewActionById, setReviewActionById] = useState<
    Record<string, ReviewActionState>
  >({});
  const [feedbackActionById, setFeedbackActionById] = useState<
    Record<string, FeedbackActionState>
  >({});
  const [moderationReasonById, setModerationReasonById] = useState<
    Record<string, string>
  >({});
  const [feedbackNoteById, setFeedbackNoteById] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      setAuthState("checking");
      try {
        const response = await fetch("/api/admin/auth/me", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setAuthState("unauthenticated");
            setAdminEmail(null);
          }
          return;
        }

        const payload = (await response.json()) as { email?: string };
        if (!cancelled) {
          setAdminEmail(String(payload.email ?? "").trim() || null);
          setAuthState("authenticated");
        }
      } catch {
        if (!cancelled) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
        }
      }
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authState !== "authenticated" || queueType !== "reviews") {
      if (authState !== "authenticated") {
        setReviewRows([]);
        setReviewState("idle");
      }
      return;
    }

    let cancelled = false;

    async function loadQueue() {
      setReviewState("loading");
      setError(null);

      try {
        const params = new URLSearchParams({
          status: reviewStatusFilter,
          limit: "60",
        });
        const response = await fetch(`/api/admin/reviews?${params.toString()}`, {
          cache: "no-store",
        });

        const payload = (await response.json()) as unknown;
        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : `Request failed (${response.status})`;
          if (response.status === 401 && !cancelled) {
            setAuthState("unauthenticated");
            setAdminEmail(null);
            setReviewRows([]);
            setReviewState("idle");
            setError("Session expired. Please sign in again.");
            return;
          }
          throw new Error(message);
        }

        const data = payload as AdminReviewQueueResponse;
        if (!cancelled) {
          setReviewRows(data.items);
          setReviewState("success");
        }
      } catch (loadError) {
        if (cancelled) return;
        setReviewRows([]);
        setReviewState("error");
        setError(loadError instanceof Error ? loadError.message : "Unknown error");
      }
    }

    loadQueue();
    return () => {
      cancelled = true;
    };
  }, [authState, queueType, reviewStatusFilter]);

  const loadDashboard = async () => {
    if (authState !== "authenticated") {
      setDashboard(null);
      setDashboardState("idle");
      setDashboardError(null);
      return;
    }

    setDashboardState("loading");
    setDashboardError(null);

    try {
      const params = new URLSearchParams({ windowDays: "7" });
      const response = await fetch(`/api/admin/dashboard?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          setDashboard(null);
          setDashboardState("idle");
          setDashboardError("Session expired. Please sign in again.");
          return;
        }
        throw new Error(message);
      }

      const data = payload as AdminDashboardResponse;
      setDashboard(data.snapshot);
      setDashboardState("success");
    } catch (loadError) {
      setDashboard(null);
      setDashboardState("error");
      setDashboardError(loadError instanceof Error ? loadError.message : "Unknown error");
    }
  };

  useEffect(() => {
    void loadDashboard();
    // auth state is the only dependency that should auto-trigger this fetch.
    // manual refresh uses the same loader through the refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  useEffect(() => {
    if (authState !== "authenticated" || queueType !== "feedback") {
      if (authState !== "authenticated") {
        setFeedbackRows([]);
        setFeedbackState("idle");
      }
      return;
    }

    let cancelled = false;

    async function loadQueue() {
      setFeedbackState("loading");
      setError(null);

      try {
        const params = new URLSearchParams({
          status: feedbackStatusFilter,
          limit: "100",
        });
        const response = await fetch(`/api/admin/feedback?${params.toString()}`, {
          cache: "no-store",
        });

        const payload = (await response.json()) as unknown;
        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : `Request failed (${response.status})`;
          if (response.status === 401 && !cancelled) {
            setAuthState("unauthenticated");
            setAdminEmail(null);
            setFeedbackRows([]);
            setFeedbackState("idle");
            setError("Session expired. Please sign in again.");
            return;
          }
          throw new Error(message);
        }

        const data = payload as AdminFeedbackQueueResponse;
        if (!cancelled) {
          setFeedbackRows(data.items);
          setFeedbackState("success");
        }
      } catch (loadError) {
        if (cancelled) return;
        setFeedbackRows([]);
        setFeedbackState("error");
        setError(loadError instanceof Error ? loadError.message : "Unknown error");
      }
    }

    loadQueue();
    return () => {
      cancelled = true;
    };
  }, [authState, feedbackStatusFilter, queueType]);

  const pendingReviewCount = useMemo(
    () => reviewRows.filter((row) => row.status === "pending").length,
    [reviewRows]
  );

  const pendingFeedbackCount = useMemo(
    () => feedbackRows.filter((row) => row.status === "pending").length,
    [feedbackRows]
  );

  const onSubmitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsLoggingIn(true);
    setError(null);
    setFlash(null);

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const payload = (await response.json()) as {
        error?: string;
        email?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? `Login failed (${response.status})`);
      }

      setAdminEmail(payload.email ?? email);
      setLoginPassword("");
      setAuthState("authenticated");
      setFlash("Signed in to moderation.");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
      setAuthState("unauthenticated");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const onLogout = async () => {
    try {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
      });
    } finally {
      setAuthState("unauthenticated");
      setAdminEmail(null);
      setReviewRows([]);
      setFeedbackRows([]);
      setReviewState("idle");
      setFeedbackState("idle");
      setFlash("Signed out.");
      setError(null);
    }
  };

  const moderateReview = async (
    submissionId: string,
    action: "approve" | "reject"
  ) => {
    if (authState !== "authenticated") {
      setError("Please sign in.");
      return;
    }

    setReviewActionById((current) => ({ ...current, [submissionId]: action }));
    setError(null);
    setFlash(null);

    try {
      const response = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submissionId,
          action,
          moderationReason: moderationReasonById[submissionId] ?? null,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        status?: ModerationStatus;
      };

      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }

      setReviewRows((current) =>
        current
          .map((item) =>
            item.submissionId === submissionId
              ? {
                  ...item,
                  status:
                    payload.status ?? (action === "approve" ? "approved" : "rejected"),
                }
              : item
          )
          .filter((item) => item.status === reviewStatusFilter)
      );

      setFlash(action === "approve" ? "Submission approved." : "Submission rejected.");
    } catch (moderationError) {
      setError(
        moderationError instanceof Error
          ? moderationError.message
          : "Moderation request failed."
      );
    } finally {
      setReviewActionById((current) => ({ ...current, [submissionId]: null }));
    }
  };

  const moderateFeedback = async (
    submissionId: string,
    targetStatus: FeedbackModerationStatus
  ) => {
    if (authState !== "authenticated") {
      setError("Please sign in.");
      return;
    }

    setFeedbackActionById((current) => ({ ...current, [submissionId]: targetStatus }));
    setError(null);
    setFlash(null);

    try {
      const response = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submissionId,
          status: targetStatus,
          reviewNote: feedbackNoteById[submissionId] ?? null,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        status?: FeedbackModerationStatus;
      };

      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }

      const nextStatus = payload.status ?? targetStatus;
      setFeedbackRows((current) =>
        current
          .map((item) =>
            item.submissionId === submissionId
              ? {
                  ...item,
                  status: nextStatus,
                  reviewedAt: nextStatus === "pending" ? null : new Date().toISOString(),
                  reviewNote: feedbackNoteById[submissionId] ?? item.reviewNote,
                }
              : item
          )
          .filter((item) => item.status === feedbackStatusFilter)
      );

      if (nextStatus === "resolved") {
        setFlash("Feedback marked as resolved.");
      } else if (nextStatus === "reviewed") {
        setFlash("Feedback marked as reviewed.");
      } else {
        setFlash("Feedback moved back to pending.");
      }
    } catch (moderationError) {
      setError(
        moderationError instanceof Error
          ? moderationError.message
          : "Feedback moderation failed."
      );
    } finally {
      setFeedbackActionById((current) => ({ ...current, [submissionId]: null }));
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <header className="mb-5">
        <p className="mb-2 inline-flex items-center rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          Admin
        </p>
        <h1 className="text-2xl font-bold text-slate-100">Moderation Queue</h1>
        <p className="mt-2 text-sm text-slate-300">
          Review user-submitted card reviews and product feedback/suggestions.
        </p>
      </header>

      {authState === "checking" && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          Checking admin session...
        </div>
      )}

      {authState === "unauthenticated" && (
        <section className="glass-panel mb-5 rounded-2xl p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate-300">
            Admin Sign In
          </p>
          <form onSubmit={onSubmitLogin} className="space-y-3">
            <label className="block text-xs text-slate-300">
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full rounded-xl bg-accent-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </section>
      )}

      {authState === "authenticated" && (
        <>
          <section className="glass-panel mb-5 flex items-center justify-between gap-3 rounded-2xl p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.1em] text-slate-400">Signed in</p>
              <p className="text-sm font-semibold text-slate-100">{adminEmail}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
            >
              Sign Out
            </button>
          </section>

          <nav className="mb-4 flex gap-2" aria-label="Admin tools">
            <span className="rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-slate-950">
              Moderation
            </span>
            <Link
              href="/admin/players"
              className="rounded-full bg-[var(--bg-pill)] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
            >
              Players
            </Link>
            <Link
              href="/admin/imports"
              className="rounded-full bg-[var(--bg-pill)] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
            >
              Imports
            </Link>
          </nav>

          <nav className="mb-4 flex gap-2" aria-label="Queue type tabs">
            <button
              type="button"
              onClick={() => setQueueType("reviews")}
              className={[
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                queueType === "reviews"
                  ? "bg-accent-500 text-slate-950"
                  : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
              ].join(" ")}
            >
              Reviews
            </button>
            <button
              type="button"
              onClick={() => setQueueType("feedback")}
              className={[
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                queueType === "feedback"
                  ? "bg-accent-500 text-slate-950"
                  : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
              ].join(" ")}
            >
              Feedback
            </button>
          </nav>

          <section className="glass-panel mb-4 rounded-2xl border border-white/10 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.1em] text-slate-400">
                  Pilot Metrics
                </p>
                <p className="text-sm text-slate-300">
                  Last 24h snapshot + rolling{" "}
                  {dashboard?.windowDays ?? 7}
                  d uniques.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={dashboardState === "loading"}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {dashboardState === "loading" ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {dashboardError && (
              <div className="mb-3 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
                {dashboardError}
              </div>
            )}

            {dashboardState === "loading" && !dashboard && (
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/5"
                  />
                ))}
              </div>
            )}

            {dashboard && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Unique 24h
                    </p>
                    <p className="mt-1 text-base font-semibold text-lime-200">
                      {dashboard.uniqueVisitors24h}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Unique {dashboard.windowDays}d
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-100">
                      {dashboard.uniqueVisitorsWindow}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Searches 24h
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-100">
                      {dashboard.searches24h}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Card Opens 24h
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-100">
                      {dashboard.cardOpens24h}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Review Submit 24h
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-100">
                      {dashboard.reviewSubmissions24h}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Review Pending
                    </p>
                    <p className="mt-1 text-base font-semibold text-amber-100">
                      {dashboard.reviewsPending}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Approval Rate 24h
                    </p>
                    <p className="mt-1 text-base font-semibold text-lime-200">
                      {formatRate(dashboard.reviewApprovalRate24h)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                      Feedback Pending
                    </p>
                    <p className="mt-1 text-base font-semibold text-sky-200">
                      {dashboard.feedbackPending}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  Open/Search: {formatRate(dashboard.openFromSearchRatePct)} ·
                  Review/Open: {formatRate(dashboard.reviewSubmitRatePct)}
                </p>
              </>
            )}
          </section>

          {queueType === "reviews" ? (
            <nav
              className="soft-scrollbar mb-5 flex snap-x gap-2 overflow-x-auto pb-2"
              aria-label="Review moderation status tabs"
            >
              {REVIEW_STATUS_TABS.map((status) => {
                const active = status === reviewStatusFilter;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setReviewStatusFilter(status)}
                    className={[
                      "shrink-0 snap-start rounded-full px-4 py-2 text-sm font-semibold transition",
                      active
                        ? "bg-accent-500 text-slate-950 shadow-[0_8px_24px_rgba(184,245,106,0.22)]"
                        : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {status}
                  </button>
                );
              })}
            </nav>
          ) : (
            <nav
              className="soft-scrollbar mb-5 flex snap-x gap-2 overflow-x-auto pb-2"
              aria-label="Feedback moderation status tabs"
            >
              {FEEDBACK_STATUS_TABS.map((status) => {
                const active = status === feedbackStatusFilter;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setFeedbackStatusFilter(status)}
                    className={[
                      "shrink-0 snap-start rounded-full px-4 py-2 text-sm font-semibold transition",
                      active
                        ? "bg-accent-500 text-slate-950 shadow-[0_8px_24px_rgba(184,245,106,0.22)]"
                        : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {status}
                  </button>
                );
              })}
            </nav>
          )}
        </>
      )}

      {flash && (
        <div className="mb-4 rounded-xl border border-lime-300/30 bg-lime-300/10 px-3 py-2 text-sm text-lime-100">
          {flash}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      {authState === "authenticated" &&
        queueType === "reviews" &&
        reviewState === "loading" && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="glass-panel h-28 animate-pulse rounded-2xl border border-white/10"
              />
            ))}
          </div>
        )}

      {authState === "authenticated" &&
        queueType === "feedback" &&
        feedbackState === "loading" && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="glass-panel h-28 animate-pulse rounded-2xl border border-white/10"
              />
            ))}
          </div>
        )}

      {authState === "authenticated" &&
        queueType === "reviews" &&
        reviewState === "success" &&
        reviewRows.length === 0 && (
          <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
            No {reviewStatusFilter} reviews in queue.
          </div>
        )}

      {authState === "authenticated" &&
        queueType === "feedback" &&
        feedbackState === "success" &&
        feedbackRows.length === 0 && (
          <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
            No {feedbackStatusFilter} feedback submissions in queue.
          </div>
        )}

      {authState === "authenticated" &&
        queueType === "reviews" &&
        reviewState === "success" &&
        reviewRows.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs text-slate-400">
              Showing {reviewRows.length} submissions
              {reviewStatusFilter === "pending" ? ` (${pendingReviewCount} pending)` : ""}
              .
            </p>

            {reviewRows.map((row) => {
              const actionState = reviewActionById[row.submissionId];
              const isBusy = actionState === "approve" || actionState === "reject";
              return (
                <article
                  key={row.submissionId}
                  className="glass-panel rounded-2xl border border-white/10 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        {row.playerName} · {row.playerOvr} · {row.playerPosition}
                      </h2>
                      <p className="mt-1 text-xs text-slate-300">
                        Submitted {formatWhen(row.submittedAt)}
                      </p>
                    </div>
                    <span
                      className={[
                        "rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                        reviewStatusClass(row.status),
                      ].join(" ")}
                    >
                      {row.status}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <p>
                      Sentiment:{" "}
                      <span className="font-semibold text-lime-200">
                        {row.sentimentScore.toFixed(1)}/10
                      </span>
                    </p>
                    <p>
                      Played:{" "}
                      <span className="font-semibold text-slate-100">
                        {row.playedPosition}
                      </span>
                    </p>
                    <p>
                      Username:{" "}
                      <span className="font-semibold text-slate-100">
                        {row.submittedUsername
                          ? `${row.submittedUsername} (${row.submittedUsernameType ?? "unknown"})`
                          : "Anonymous"}
                      </span>
                    </p>
                    <p>
                      Rank:{" "}
                      <span className="font-semibold text-slate-100">
                        {row.mentionedRankText ?? "Not specified"}
                      </span>
                    </p>
                  </div>

                  {row.note && (
                    <p className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm leading-relaxed text-slate-200">
                      {row.note}
                    </p>
                  )}

                  <label className="mt-3 block text-xs text-slate-300">
                    Moderation reason (optional)
                    <input
                      type="text"
                      value={moderationReasonById[row.submissionId] ?? ""}
                      onChange={(event) =>
                        setModerationReasonById((current) => ({
                          ...current,
                          [row.submissionId]: event.target.value,
                        }))
                      }
                      placeholder="Optional note for reject/approve action"
                      maxLength={300}
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>

                  {row.status === "pending" && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => moderateReview(row.submissionId, "approve")}
                        className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionState === "approve" ? "Approving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => moderateReview(row.submissionId, "reject")}
                        className="rounded-xl border border-rose-300/35 bg-rose-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionState === "reject" ? "Rejecting..." : "Reject"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

      {authState === "authenticated" &&
        queueType === "feedback" &&
        feedbackState === "success" &&
        feedbackRows.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs text-slate-400">
              Showing {feedbackRows.length} feedback entries
              {feedbackStatusFilter === "pending"
                ? ` (${pendingFeedbackCount} pending)`
                : ""}
              .
            </p>

            {feedbackRows.map((row) => {
              const actionState = feedbackActionById[row.submissionId];
              const isBusy = Boolean(actionState);
              return (
                <article
                  key={row.submissionId}
                  className="glass-panel rounded-2xl border border-white/10 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        {feedbackCategoryLabel(row.category)}
                      </h2>
                      <p className="mt-1 text-xs text-slate-300">
                        {feedbackCategoryHint(row.category)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Submitted {formatWhen(row.createdAt)}
                        {row.reviewedAt ? ` · Reviewed ${formatWhen(row.reviewedAt)}` : ""}
                      </p>
                    </div>
                    <span
                      className={[
                        "rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                        feedbackStatusClass(row.status),
                      ].join(" ")}
                    >
                      {row.status}
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm leading-relaxed text-slate-200">
                    {row.message}
                  </p>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-300">
                    <p>
                      Contact:{" "}
                      <span className="font-semibold text-slate-100">
                        {row.contact || "Anonymous"}
                      </span>
                    </p>
                  </div>

                  <label className="mt-3 block text-xs text-slate-300">
                    Review note (optional)
                    <input
                      type="text"
                      value={feedbackNoteById[row.submissionId] ?? row.reviewNote ?? ""}
                      onChange={(event) =>
                        setFeedbackNoteById((current) => ({
                          ...current,
                          [row.submissionId]: event.target.value,
                        }))
                      }
                      placeholder="Optional admin note"
                      maxLength={400}
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {row.status !== "reviewed" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => moderateFeedback(row.submissionId, "reviewed")}
                        className="rounded-xl border border-cyan-300/35 bg-cyan-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionState === "reviewed" ? "Saving..." : "Mark Reviewed"}
                      </button>
                    )}
                    {row.status !== "resolved" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => moderateFeedback(row.submissionId, "resolved")}
                        className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionState === "resolved" ? "Saving..." : "Resolve"}
                      </button>
                    )}
                    {row.status !== "pending" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => moderateFeedback(row.submissionId, "pending")}
                        className="rounded-xl border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionState === "pending" ? "Saving..." : "Move to Pending"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
    </main>
  );
}
