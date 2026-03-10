"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AdminPlayerItem, AdminPlayersListResponse } from "@/types/admin";
import {
  AdminRedditImportPreview,
  AdminRedditImportPreviewResponse,
  AdminRedditImportPublishResponse,
  RedditWatchlistItem,
  RedditWatchlistMutationResponse,
  RedditWatchlistResponse,
  RedditWatchlistRunResponse,
} from "@/types/admin-imports";

type AuthState = "checking" | "authenticated" | "unauthenticated";
type FetchState = "idle" | "loading" | "success" | "error";
type SourceMode = "url" | "text";

type ImportDraft = {
  sourceMode: SourceMode;
  sourceUrl: string;
  rawText: string;
  subreddit: string;
  playerName: string;
  playerOvr: string;
  eventName: string;
  playedPosition: string;
  mentionedRankText: string;
  sentimentScore: string;
  prosText: string;
  consText: string;
  summary: string;
};

const POSITION_OPTIONS = [
  "ST",
  "CF",
  "LW",
  "RW",
  "LF",
  "RF",
  "CAM",
  "CM",
  "CDM",
  "LM",
  "RM",
  "CB",
  "LB",
  "RB",
  "LWB",
  "RWB",
  "GK",
];

const RANK_OPTIONS = ["", "Base", "Blue", "Purple", "Red", "Gold"];

function normalizeCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

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

function confidenceLabel(value: number) {
  if (value >= 0.8) return "High confidence";
  if (value >= 0.55) return "Medium confidence";
  return "Low confidence";
}

function toInitialDraft(): ImportDraft {
  return {
    sourceMode: "url",
    sourceUrl: "",
    rawText: "",
    subreddit: "",
    playerName: "",
    playerOvr: "",
    eventName: "",
    playedPosition: "",
    mentionedRankText: "",
    sentimentScore: "",
    prosText: "",
    consText: "",
    summary: "",
  };
}

export default function AdminImportsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [pageError, setPageError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [draft, setDraft] = useState<ImportDraft>(toInitialDraft);
  const [previewState, setPreviewState] = useState<FetchState>("idle");
  const [preview, setPreview] = useState<AdminRedditImportPreview | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const [playerSearchQuery, setPlayerSearchQuery] = useState("");
  const [playerSearchState, setPlayerSearchState] = useState<FetchState>("idle");
  const [playerSearchRows, setPlayerSearchRows] = useState<AdminPlayerItem[]>([]);

  const [watchlistState, setWatchlistState] = useState<FetchState>("idle");
  const [watchlistRows, setWatchlistRows] = useState<RedditWatchlistItem[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<AdminPlayerItem | null>(null);
  const [watchlistSearchTerms, setWatchlistSearchTerms] = useState("");
  const [watchlistSubreddits, setWatchlistSubreddits] = useState("FUTMobile, EASportsFCMobile");
  const [isSavingWatchlist, setIsSavingWatchlist] = useState(false);
  const [isRunningWatchlist, setIsRunningWatchlist] = useState(false);
  const [watchlistActionById, setWatchlistActionById] = useState<Record<string, boolean>>({});

  const selectedPlayerSummary = useMemo(() => {
    if (!selectedPlayer) return null;
    return `${selectedPlayer.playerName} · ${selectedPlayer.baseOvr} · ${selectedPlayer.basePosition}`;
  }, [selectedPlayer]);

  const loadWatchlistRowForEdit = (row: RedditWatchlistItem) => {
    setSelectedPlayer({
      playerId: row.playerId,
      playerName: row.playerName,
      baseOvr: row.baseOvr,
      basePosition: row.basePosition,
      programPromo: row.programPromo,
      isActive: row.isActive,
      mentionCount: 0,
      avgSentimentScore: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    setWatchlistSearchTerms(row.searchTerms.join(", "));
    setWatchlistSubreddits(row.subreddits.join(", "));
  };

  const resetDraftFromPreview = (nextPreview: AdminRedditImportPreview) => {
    setDraft((current) => ({
      ...current,
      sourceMode: nextPreview.sourceMode,
      sourceUrl: nextPreview.sourceUrl ?? current.sourceUrl,
      rawText: nextPreview.sourceMode === "text" ? nextPreview.body : current.rawText,
      subreddit: nextPreview.sourceSubreddit ?? current.subreddit,
      playerName: nextPreview.extractedPlayerName,
      playerOvr:
        nextPreview.extractedPlayerOvr === null ? "" : String(nextPreview.extractedPlayerOvr),
      eventName: nextPreview.extractedEventName ?? "",
      playedPosition: nextPreview.extractedPlayedPosition ?? "",
      mentionedRankText: nextPreview.extractedRankText ?? "",
      sentimentScore:
        nextPreview.extractedSentimentScore === null
          ? ""
          : String(nextPreview.extractedSentimentScore),
      prosText: nextPreview.extractedPros.join(", "),
      consText: nextPreview.extractedCons.join(", "),
      summary: nextPreview.extractedSummary ?? "",
    }));
  };

  const loadAuth = async () => {
    setAuthState("checking");
    try {
      const response = await fetch("/api/admin/auth/me", { cache: "no-store" });
      if (!response.ok) {
        setAuthState("unauthenticated");
        setAdminEmail(null);
        return;
      }
      const payload = (await response.json()) as { email?: string };
      setAdminEmail(String(payload.email ?? "").trim() || null);
      setAuthState("authenticated");
    } catch {
      setAuthState("unauthenticated");
      setAdminEmail(null);
    }
  };

  const loadWatchlist = async () => {
    if (authState !== "authenticated") {
      setWatchlistRows([]);
      setWatchlistState("idle");
      return;
    }

    setWatchlistState("loading");
    try {
      const response = await fetch("/api/admin/reddit/watchlist", { cache: "no-store" });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      const data = payload as RedditWatchlistResponse;
      setWatchlistRows(data.items);
      setWatchlistState("success");
    } catch (error) {
      setWatchlistRows([]);
      setWatchlistState("error");
      setPageError(error instanceof Error ? error.message : "Failed to load watchlist.");
    }
  };

  useEffect(() => {
    void loadAuth();
  }, []);

  useEffect(() => {
    void loadWatchlist();
  }, [authState]);

  const onSubmitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    if (!email || !password) {
      setPageError("Email and password are required.");
      return;
    }

    setIsLoggingIn(true);
    setPageError(null);
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string; email?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }
      setAdminEmail(payload.email ?? email);
      setAuthState("authenticated");
      setFlash("Signed in to admin tools.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to sign in.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const onLogout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    setAuthState("unauthenticated");
    setAdminEmail(null);
    setFlash("Signed out.");
  };

  const onPreviewImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPreviewState("loading");
    setPageError(null);
    setFlash(null);
    setPreview(null);

    try {
      const response = await fetch("/api/admin/reddit/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: draft.sourceMode === "url" ? draft.sourceUrl : null,
          rawText: draft.sourceMode === "text" ? draft.rawText : null,
          subreddit: draft.subreddit,
          playerName: draft.playerName || null,
          playerOvr: draft.playerOvr ? Number(draft.playerOvr) : null,
          eventName: draft.eventName || null,
          playedPosition: draft.playedPosition || null,
        }),
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
        throw new Error(message);
      }

      const data = payload as AdminRedditImportPreviewResponse;
      setPreview(data.preview);
      resetDraftFromPreview(data.preview);
      setPreviewState("success");
      setFlash("Preview generated. Review the extracted fields before publishing.");
    } catch (error) {
      setPreviewState("error");
      setPageError(error instanceof Error ? error.message : "Failed to preview import.");
    }
  };

  const onPublishImport = async () => {
    if (!preview) {
      setPageError("Generate a preview before publishing.");
      return;
    }

    setIsPublishing(true);
    setPageError(null);
    setFlash(null);
    try {
      const response = await fetch("/api/admin/reddit/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMode: preview.sourceMode,
          sourceUrl: preview.sourceUrl,
          sourceSubreddit: draft.subreddit || preview.sourceSubreddit,
          sourceAuthor: preview.sourceAuthor,
          sourcePublishedAt: preview.sourcePublishedAt,
          sourceExternalId: preview.sourceExternalId,
          sourcePostId: null,
          title: preview.title,
          body: preview.body,
          playerName: draft.playerName,
          playerOvr: Number(draft.playerOvr),
          eventName: draft.eventName || null,
          playedPosition: draft.playedPosition,
          mentionedRankText: draft.mentionedRankText || null,
          sentimentScore: Number(draft.sentimentScore),
          pros: normalizeCsv(draft.prosText),
          cons: normalizeCsv(draft.consText),
          summary: draft.summary || null,
        }),
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
        throw new Error(message);
      }

      const data = payload as AdminRedditImportPublishResponse;
      setFlash(data.message);
      setPreview(null);
      setDraft(toInitialDraft());
      void loadWatchlist();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to publish import.");
    } finally {
      setIsPublishing(false);
    }
  };

  const searchPlayers = async (query: string) => {
    const cleaned = query.trim();
    setPlayerSearchQuery(cleaned);
    if (cleaned.length < 2) {
      setPlayerSearchRows([]);
      setPlayerSearchState("idle");
      return;
    }

    setPlayerSearchState("loading");
    try {
      const params = new URLSearchParams({ q: cleaned, limit: "12" });
      const response = await fetch(`/api/admin/players?${params.toString()}`, {
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
        throw new Error(message);
      }

      const data = payload as AdminPlayersListResponse;
      setPlayerSearchRows(data.items);
      setPlayerSearchState("success");
    } catch (error) {
      setPlayerSearchState("error");
      setPageError(error instanceof Error ? error.message : "Failed to search players.");
    }
  };

  const onSaveWatchlist = async () => {
    if (!selectedPlayer) {
      setPageError("Select a player to add to the watchlist.");
      return;
    }

    setIsSavingWatchlist(true);
    setPageError(null);
    setFlash(null);
    try {
      const response = await fetch("/api/admin/reddit/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: selectedPlayer.playerId,
          searchTerms: normalizeCsv(watchlistSearchTerms),
          subreddits: normalizeCsv(watchlistSubreddits),
          isActive: true,
        }),
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
        throw new Error(message);
      }

      const data = payload as RedditWatchlistMutationResponse;
      setWatchlistRows((current) => {
        const next = current.filter((row) => row.id !== data.item.id && row.playerId !== data.item.playerId);
        next.unshift(data.item);
        return next;
      });
      setSelectedPlayer(null);
      setWatchlistSearchTerms("");
      setWatchlistSubreddits("FUTMobile, EASportsFCMobile");
      setFlash("Watchlist entry saved.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to save watchlist.");
    } finally {
      setIsSavingWatchlist(false);
    }
  };

  const onToggleWatchlist = async (row: RedditWatchlistItem, nextActive: boolean) => {
    setWatchlistActionById((current) => ({ ...current, [row.id]: true }));
    setPageError(null);
    try {
      const response = await fetch("/api/admin/reddit/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, isActive: nextActive }),
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
        throw new Error(message);
      }
      const data = payload as RedditWatchlistMutationResponse;
      setWatchlistRows((current) =>
        current.map((item) => (item.id === data.item.id ? data.item : item))
      );
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to update watchlist.");
    } finally {
      setWatchlistActionById((current) => ({ ...current, [row.id]: false }));
    }
  };

  const onRunWatchlist = async () => {
    setIsRunningWatchlist(true);
    setPageError(null);
    setFlash(null);
    try {
      const response = await fetch("/api/admin/reddit/watchlist/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitPerEntry: 3 }),
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
        throw new Error(message);
      }
      const data = payload as RedditWatchlistRunResponse;
      setFlash(
        `Watchlist sync finished. Imported ${data.importedMentions} mention${data.importedMentions === 1 ? "" : "s"} from ${data.discoveredPosts} discovered post${data.discoveredPosts === 1 ? "" : "s"}.`
      );
      await loadWatchlist();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to run watchlist sync.");
    } finally {
      setIsRunningWatchlist(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(163,230,53,0.15),_transparent_26%),linear-gradient(120deg,_rgba(8,15,27,0.97),_rgba(3,22,46,0.96)_55%,_rgba(0,30,70,0.92))] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 inline-flex rounded-full border border-lime-300/35 bg-lime-300/12 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-lime-200">
          Admin
        </div>
        <h1 className="mb-2 text-4xl font-semibold tracking-tight sm:text-5xl">Reddit Imports</h1>
        <p className="mb-6 max-w-3xl text-base text-slate-300 sm:text-lg">
          Import high-signal Reddit reviews manually, and keep a small watchlist of active cards
          for controlled polling.
        </p>

        {pageError && (
          <div className="mb-4 rounded-2xl border border-rose-300/35 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {pageError}
          </div>
        )}
        {flash && (
          <div className="mb-4 rounded-2xl border border-lime-300/35 bg-lime-300/10 px-4 py-3 text-sm text-lime-100">
            {flash}
          </div>
        )}

        {authState === "checking" && (
          <section className="glass-panel rounded-3xl border border-white/10 p-6">
            <p className="text-sm text-slate-300">Checking admin session...</p>
          </section>
        )}

        {authState === "unauthenticated" && (
          <section className="glass-panel max-w-md rounded-3xl border border-white/10 p-6">
            <h2 className="mb-2 text-xl font-semibold">Admin Sign In</h2>
            <p className="mb-4 text-sm text-slate-400">Only approved admin emails can access import tools.</p>
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

            <nav className="mb-5 flex gap-2" aria-label="Admin tools">
              <Link
                href="/admin/moderation"
                className="rounded-full bg-[var(--bg-pill)] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
              >
                Moderation
              </Link>
              <Link
                href="/admin/players"
                className="rounded-full bg-[var(--bg-pill)] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
              >
                Players
              </Link>
              <span className="rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-slate-950">
                Imports
              </span>
            </nav>

            <section className="glass-panel mb-6 rounded-2xl p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-[0.1em] text-slate-300">Reddit Import</p>
                  <p className="text-sm text-slate-400">
                    Paste a Reddit URL or raw text, preview the extracted review, then publish it
                    into the live Reddit-sourced review surface.
                  </p>
                </div>
              </div>

              <form onSubmit={onPreviewImport} className="space-y-4">
                <div className="flex gap-2">
                  {(["url", "text"] as SourceMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, sourceMode: mode }))}
                      className={[
                        "rounded-full px-4 py-2 text-sm font-semibold transition",
                        draft.sourceMode === mode
                          ? "bg-accent-500 text-slate-950"
                          : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
                      ].join(" ")}
                    >
                      {mode === "url" ? "Reddit URL" : "Raw Text"}
                    </button>
                  ))}
                </div>

                {draft.sourceMode === "url" ? (
                  <label className="block text-xs text-slate-300">
                    Reddit URL
                    <input
                      type="url"
                      value={draft.sourceUrl}
                      onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))}
                      placeholder="https://www.reddit.com/r/FUTMobile/comments/..."
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                ) : (
                  <label className="block text-xs text-slate-300">
                    Raw Reddit text
                    <textarea
                      value={draft.rawText}
                      onChange={(event) => setDraft((current) => ({ ...current, rawText: event.target.value }))}
                      rows={8}
                      placeholder="Paste the Reddit post or comment text here."
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-300">
                    Subreddit override (optional)
                    <input
                      type="text"
                      value={draft.subreddit}
                      onChange={(event) => setDraft((current) => ({ ...current, subreddit: event.target.value }))}
                      placeholder="FUTMobile"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={previewState === "loading"}
                      className="w-full rounded-xl border border-lime-300/35 bg-lime-300/12 px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {previewState === "loading" ? "Generating Preview..." : "Preview Import"}
                    </button>
                  </div>
                </div>
              </form>

              {preview && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.12em] text-slate-300">
                      {preview.sourceMode === "url" ? "URL import" : "Text import"}
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.12em] text-slate-300">
                      {confidenceLabel(preview.confidence)}
                    </span>
                    {preview.needsReview && (
                      <span className="rounded-full border border-amber-300/35 bg-amber-300/12 px-3 py-1 text-xs uppercase tracking-[0.12em] text-amber-100">
                        Manual review recommended
                      </span>
                    )}
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Candidate</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {preview.playerCandidate
                          ? `${preview.playerCandidate.playerName} · ${preview.playerCandidate.baseOvr}`
                          : "No confident match"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Source</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {preview.sourceSubreddit ? `r/${preview.sourceSubreddit}` : "Reddit"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Published</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">
                        {formatWhen(preview.sourcePublishedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-300">
                      Player Name
                      <input
                        type="text"
                        value={draft.playerName}
                        onChange={(event) => setDraft((current) => ({ ...current, playerName: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-300">
                      OVR
                      <input
                        type="number"
                        min={1}
                        max={130}
                        value={draft.playerOvr}
                        onChange={(event) => setDraft((current) => ({ ...current, playerOvr: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-300">
                      Event / Program
                      <input
                        type="text"
                        value={draft.eventName}
                        onChange={(event) => setDraft((current) => ({ ...current, eventName: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-300">
                      Played Position
                      <select
                        value={draft.playedPosition}
                        onChange={(event) => setDraft((current) => ({ ...current, playedPosition: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        <option value="">Select position</option>
                        {POSITION_OPTIONS.map((position) => (
                          <option key={position} value={position} className="bg-slate-900 text-slate-100">
                            {position}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-300">
                      Sentiment Score
                      <input
                        type="number"
                        min={1}
                        max={10}
                        step="0.1"
                        value={draft.sentimentScore}
                        onChange={(event) => setDraft((current) => ({ ...current, sentimentScore: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-300">
                      Mentioned Rank
                      <select
                        value={draft.mentionedRankText}
                        onChange={(event) => setDraft((current) => ({ ...current, mentionedRankText: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        {RANK_OPTIONS.map((option) => (
                          <option key={option || "blank"} value={option} className="bg-slate-900 text-slate-100">
                            {option || "Not mentioned"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-slate-300 sm:col-span-2">
                      Pros (comma separated)
                      <input
                        type="text"
                        value={draft.prosText}
                        onChange={(event) => setDraft((current) => ({ ...current, prosText: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-300 sm:col-span-2">
                      Cons (comma separated)
                      <input
                        type="text"
                        value={draft.consText}
                        onChange={(event) => setDraft((current) => ({ ...current, consText: event.target.value }))}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="text-xs text-slate-300 sm:col-span-2">
                      Summary
                      <textarea
                        value={draft.summary}
                        onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={onPublishImport}
                      disabled={isPublishing}
                      className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isPublishing ? "Publishing..." : "Publish Reddit Import"}
                    </button>
                    {preview.sourceUrl && (
                      <a
                        href={preview.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        Open Source
                      </a>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="glass-panel rounded-2xl p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-[0.1em] text-slate-300">Reddit Watchlist</p>
                  <p className="text-sm text-slate-400">
                    Track only the cards that matter. Polling stays narrow, predictable, and tied to
                    active demand.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRunWatchlist}
                  disabled={isRunningWatchlist}
                  className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isRunningWatchlist ? "Running..." : "Run Watchlist Sync"}
                </button>
              </div>

              <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="text-xs text-slate-300">
                    Search player
                    <input
                      type="text"
                      value={playerSearchQuery}
                      onChange={(event) => void searchPlayers(event.target.value)}
                      placeholder="Search by player name or OVR"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={onSaveWatchlist}
                      disabled={isSavingWatchlist || !selectedPlayer}
                      className="w-full rounded-xl border border-lime-300/35 bg-lime-300/12 px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSavingWatchlist ? "Saving..." : "Add / Update"}
                    </button>
                  </div>
                </div>

                {selectedPlayerSummary && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
                    Selected: {selectedPlayerSummary}
                  </div>
                )}

                {playerSearchState === "success" && playerSearchRows.length > 0 && (
                  <div className="mt-3 grid gap-2">
                    {playerSearchRows.slice(0, 6).map((row) => (
                      <button
                        key={row.playerId}
                        type="button"
                        onClick={() => {
                          setSelectedPlayer(row);
                          setWatchlistSearchTerms(`${row.baseOvr} ${row.playerName}, ${row.playerName} ${row.baseOvr}, ${row.playerName}`);
                        }}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
                      >
                        <p className="text-sm font-semibold text-slate-100">
                          {row.playerName} · {row.baseOvr} · {row.basePosition}
                        </p>
                        <p className="text-xs text-slate-400">{row.programPromo}</p>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-300">
                    Search terms (comma separated)
                    <input
                      type="text"
                      value={watchlistSearchTerms}
                      onChange={(event) => setWatchlistSearchTerms(event.target.value)}
                      placeholder="117 Messi, Messi 117, Messi"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="text-xs text-slate-300">
                    Subreddits (comma separated)
                    <input
                      type="text"
                      value={watchlistSubreddits}
                      onChange={(event) => setWatchlistSubreddits(event.target.value)}
                      placeholder="FUTMobile, EASportsFCMobile"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>
              </div>

              {watchlistState === "loading" && (
                <p className="text-sm text-slate-400">Loading watchlist...</p>
              )}
              {watchlistState !== "loading" && watchlistRows.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-400">
                  No watchlist entries yet.
                </div>
              )}

              <div className="grid gap-3">
                {watchlistRows.map((row) => (
                  <article key={row.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-100">
                          {row.playerName} · {row.baseOvr} · {row.basePosition}
                        </p>
                        <p className="text-sm text-slate-400">{row.programPromo}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          Last polled: {formatWhen(row.lastPolledAt)} · Last import count: {row.lastResultCount}
                        </p>
                      </div>
                      <span
                        className={[
                          "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]",
                          row.isActive
                            ? "border border-lime-300/35 bg-lime-300/12 text-lime-100"
                            : "border border-white/15 bg-white/5 text-slate-300",
                        ].join(" ")}
                      >
                        {row.isActive ? "Active" : "Paused"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                      <p>
                        <span className="text-slate-500">Terms:</span> {row.searchTerms.join(", ")}
                      </p>
                      <p>
                        <span className="text-slate-500">Subreddits:</span> {row.subreddits.join(", ")}
                      </p>
                    </div>
                    <div className="mt-4 flex gap-3">
                      <button
                        type="button"
                        onClick={() => loadWatchlistRowForEdit(row)}
                        className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onToggleWatchlist(row, !row.isActive)}
                        disabled={watchlistActionById[row.id]}
                        className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {watchlistActionById[row.id]
                          ? "Saving..."
                          : row.isActive
                            ? "Pause"
                            : "Resume"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
