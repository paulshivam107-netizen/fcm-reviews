"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AdminReviewQueueItem,
  AdminReviewQueueResponse,
  ModerationStatus,
} from "@/types/review";

type FetchState = "idle" | "loading" | "success" | "error";
type AuthState = "checking" | "authenticated" | "unauthenticated";
type ActionState = "approve" | "reject" | null;

const STATUS_TABS: ModerationStatus[] = ["pending", "approved", "rejected"];

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusClass(status: ModerationStatus) {
  if (status === "approved") {
    return "border-lime-300/40 bg-lime-300/12 text-lime-100";
  }
  if (status === "rejected") {
    return "border-rose-300/40 bg-rose-300/12 text-rose-100";
  }
  return "border-amber-300/40 bg-amber-300/12 text-amber-100";
}

export default function AdminModerationPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ModerationStatus>("pending");
  const [rows, setRows] = useState<AdminReviewQueueItem[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionById, setActionById] = useState<Record<string, ActionState>>({});
  const [moderationReasonById, setModerationReasonById] = useState<
    Record<string, string>
  >({});

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
    if (authState !== "authenticated") {
      setRows([]);
      setState("idle");
      return;
    }

    let cancelled = false;

    async function loadQueue() {
      setState("loading");
      setError(null);

      try {
        const params = new URLSearchParams({
          status: statusFilter,
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
            setRows([]);
            setState("idle");
            setError("Session expired. Please sign in again.");
            return;
          }
          throw new Error(message);
        }

        const data = payload as AdminReviewQueueResponse;
        if (!cancelled) {
          setRows(data.items);
          setState("success");
        }
      } catch (loadError) {
        if (cancelled) return;
        setRows([]);
        setState("error");
        setError(loadError instanceof Error ? loadError.message : "Unknown error");
      }
    }

    loadQueue();
    return () => {
      cancelled = true;
    };
  }, [authState, statusFilter]);

  const pendingCount = useMemo(
    () => rows.filter((row) => row.status === "pending").length,
    [rows]
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
    setFeedback(null);

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
      setFeedback("Signed in to moderation.");
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
      setRows([]);
      setState("idle");
      setFeedback("Signed out.");
      setError(null);
    }
  };

  const moderateSubmission = async (
    submissionId: string,
    action: "approve" | "reject"
  ) => {
    if (authState !== "authenticated") {
      setError("Please sign in.");
      return;
    }

    setActionById((current) => ({ ...current, [submissionId]: action }));
    setError(null);
    setFeedback(null);

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

      setRows((current) =>
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
          .filter((item) => item.status === statusFilter)
      );

      setFeedback(action === "approve" ? "Submission approved." : "Submission rejected.");
    } catch (moderationError) {
      setError(
        moderationError instanceof Error
          ? moderationError.message
          : "Moderation request failed."
      );
    } finally {
      setActionById((current) => ({ ...current, [submissionId]: null }));
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
          Approve or reject user-submitted reviews before they appear publicly.
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

          <nav
            className="soft-scrollbar mb-5 flex snap-x gap-2 overflow-x-auto pb-2"
            aria-label="Moderation status tabs"
          >
            {STATUS_TABS.map((status) => {
              const active = status === statusFilter;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
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
        </>
      )}

      {feedback && (
        <div className="mb-4 rounded-xl border border-lime-300/30 bg-lime-300/10 px-3 py-2 text-sm text-lime-100">
          {feedback}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      {authState === "authenticated" && state === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="glass-panel h-28 animate-pulse rounded-2xl border border-white/10"
            />
          ))}
        </div>
      )}

      {authState === "authenticated" && state === "success" && rows.length === 0 && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          No {statusFilter} reviews in queue.
        </div>
      )}

      {authState === "authenticated" && state === "success" && rows.length > 0 && (
        <section className="space-y-3">
          <p className="text-xs text-slate-400">
            Showing {rows.length} submissions
            {statusFilter === "pending" ? ` (${pendingCount} pending)` : ""}.
          </p>

          {rows.map((row) => {
            const actionState = actionById[row.submissionId];
            const isBusy = actionState !== null;
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
                      statusClass(row.status),
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
                      onClick={() => moderateSubmission(row.submissionId, "approve")}
                      className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {actionState === "approve" ? "Approving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => moderateSubmission(row.submissionId, "reject")}
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
    </main>
  );
}

