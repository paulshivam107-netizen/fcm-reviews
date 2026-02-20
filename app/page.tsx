"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { POSITION_GROUPS, TAB_LABELS, parseTab } from "@/lib/position-groups";
import { PlayersApiResponse, PlayerRow, PlayerTab } from "@/types/player";
import { SubmittedUsernameType } from "@/types/review";

type FetchState = "idle" | "loading" | "success" | "error";

type ReviewFormState = {
  sentimentScore: number;
  playedPosition: string;
  mentionedRankText: string;
  pros: string[];
  cons: string[];
  note: string;
  submittedUsername: string;
  submittedUsernameType: SubmittedUsernameType | "";
};

type ReviewFeedback = {
  kind: "success" | "error";
  message: string;
};

const ATTRIBUTE_TAGS = [
  "Pace",
  "Finishing",
  "Dribbling",
  "Passing",
  "Physical",
  "Positioning",
  "Weak Foot",
  "Long Shots",
] as const;

const RANK_OPTIONS = ["", "Base", "Blue", "Purple", "Red", "Gold"] as const;

function formatSentiment(score: number | null) {
  if (score === null || Number.isNaN(score)) return "N/A";
  return `${score.toFixed(1)}/10`;
}

function buildInitialReviewForm(player: PlayerRow): ReviewFormState {
  return {
    sentimentScore: 8,
    playedPosition: player.base_position,
    mentionedRankText: "",
    pros: [],
    cons: [],
    note: "",
    submittedUsername: "",
    submittedUsernameType: "",
  };
}

function normalizePositionInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

function StarMeter({ score }: { score: number | null }) {
  if (score === null || Number.isNaN(score)) {
    return <span className="text-xs text-slate-400">No score yet</span>;
  }
  const filled = Math.max(0, Math.min(10, Math.round(score)));
  return (
    <span className="star-track text-accent-400">
      {"★".repeat(filled)}
      <span className="text-slate-500">{"★".repeat(10 - filled)}</span>
    </span>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10"
        />
      ))}
    </div>
  );
}

function PlayerCard({
  row,
  index,
  onAddReview,
}: {
  row: PlayerRow;
  index: number;
  onAddReview: (player: PlayerRow) => void;
}) {
  return (
    <article
      className="glass-panel card-reveal rounded-2xl p-4 transition duration-300 hover:border-lime-300/50"
      style={{ animationDelay: `${Math.min(index * 45, 220)}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-100">
            {row.player_name}
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            OVR {row.base_ovr} · {row.base_position}
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
          {row.program_promo}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">
            Sentiment
          </p>
          <p className="mt-1 text-sm font-semibold text-lime-300">
            {formatSentiment(row.avg_sentiment_score)}
          </p>
        </div>
        <StarMeter score={row.avg_sentiment_score} />
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => onAddReview(row)}
          className="w-full rounded-xl border border-lime-300/35 bg-lime-300/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
        >
          Add Review
        </button>
      </div>
    </article>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<PlayerTab>("attacker");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewFormState | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<ReviewFeedback | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  const tabList = useMemo(
    () => Object.keys(POSITION_GROUPS).map((tab) => parseTab(tab)),
    []
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setState("loading");
      setError(null);

      try {
        const params = new URLSearchParams({
          tab: activeTab,
          q: query,
          limit: "30",
        });
        const response = await fetch(`/api/players?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as PlayersApiResponse;
        if (!cancelled) {
          setRows(payload.items);
          setState("success");
        }
      } catch (err) {
        if (cancelled) return;
        setState("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, query]);

  const onSubmitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(queryDraft.trim());
  };

  const onSelectPlayerForReview = (player: PlayerRow) => {
    setSelectedPlayer(player);
    setReviewForm(buildInitialReviewForm(player));
    setReviewFeedback(null);
  };

  const closeReviewPanel = () => {
    setSelectedPlayer(null);
    setReviewForm(null);
    setReviewFeedback(null);
  };

  const onChangeReviewField =
    <K extends keyof ReviewFormState>(field: K) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      if (!reviewForm) return;

      const nextValue = event.target.value;
      if (field === "sentimentScore") {
        const parsed = Number(nextValue);
        setReviewForm({
          ...reviewForm,
          sentimentScore: Number.isFinite(parsed)
            ? Math.max(1, Math.min(10, Math.round(parsed)))
            : reviewForm.sentimentScore,
        });
        return;
      }

      if (field === "playedPosition") {
        setReviewForm({
          ...reviewForm,
          playedPosition: normalizePositionInput(nextValue),
        });
        return;
      }

      if (field === "submittedUsernameType") {
        setReviewForm({
          ...reviewForm,
          submittedUsernameType: nextValue as SubmittedUsernameType | "",
        });
        return;
      }

      setReviewForm({ ...reviewForm, [field]: nextValue });
    };

  const toggleTag = (kind: "pros" | "cons", tag: string, max: number) => {
    if (!reviewForm) return;

    const source = kind === "pros" ? reviewForm.pros : reviewForm.cons;
    const hasTag = source.includes(tag);

    let next: string[];
    if (hasTag) {
      next = source.filter((item) => item !== tag);
    } else {
      if (source.length >= max) return;
      next = [...source, tag];
    }

    setReviewForm({ ...reviewForm, [kind]: next });
  };

  const onSubmitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedPlayer || !reviewForm || isSubmittingReview) {
      return;
    }

    if (reviewForm.submittedUsername && !reviewForm.submittedUsernameType) {
      setReviewFeedback({
        kind: "error",
        message: "Choose username type (Reddit or In-game).",
      });
      return;
    }

    if (!reviewForm.submittedUsername && reviewForm.submittedUsernameType) {
      setReviewFeedback({
        kind: "error",
        message: "Enter username if you select username type.",
      });
      return;
    }

    if (!reviewForm.playedPosition || reviewForm.playedPosition.length < 2) {
      setReviewFeedback({
        kind: "error",
        message: "Enter a valid played position, for example ST or CAM.",
      });
      return;
    }

    setIsSubmittingReview(true);
    setReviewFeedback(null);

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerId: selectedPlayer.player_id,
          sentimentScore: reviewForm.sentimentScore,
          playedPosition: reviewForm.playedPosition,
          mentionedRankText: reviewForm.mentionedRankText || null,
          pros: reviewForm.pros,
          cons: reviewForm.cons,
          note: reviewForm.note || null,
          submittedUsername: reviewForm.submittedUsername || null,
          submittedUsernameType: reviewForm.submittedUsernameType || null,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setReviewFeedback({
          kind: "error",
          message: payload.error ?? "Could not submit review.",
        });
        return;
      }

      setReviewFeedback({
        kind: "success",
        message: payload.message ?? "Review submitted and pending moderation.",
      });
      setReviewForm(buildInitialReviewForm(selectedPlayer));
    } catch {
      setReviewFeedback({
        kind: "error",
        message: "Network error while submitting review.",
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <header className="mb-6">
        <p className="mb-2 inline-flex items-center rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          FC Mobile Reviews
        </p>
        <h1 className="text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">
          Scout The Meta.
          <span className="block bg-gradient-to-r from-lime-200 to-lime-400 bg-clip-text text-transparent">
            Pick Better Players.
          </span>
        </h1>
        <p className="mt-2 max-w-[32ch] text-sm text-slate-300">
          Real community sentiment for the cards people actually use.
        </p>
      </header>

      <form onSubmit={onSubmitSearch} className="mb-5">
        <label htmlFor="player-search" className="sr-only">
          Search players
        </label>
        <div className="glass-panel flex items-center gap-2 rounded-2xl px-4 py-3">
          <span className="text-slate-300" aria-hidden>
            ⌕
          </span>
          <input
            id="player-search"
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search player or try “113 Messi”"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </form>

      <nav
        className="soft-scrollbar mb-6 flex snap-x gap-2 overflow-x-auto pb-2"
        aria-label="Player role tabs"
      >
        {tabList.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "shrink-0 snap-start rounded-full px-4 py-2 text-sm font-semibold transition",
                active
                  ? "bg-accent-500 text-slate-950 shadow-[0_8px_24px_rgba(184,245,106,0.22)]"
                  : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
              ].join(" ")}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>

      <section className="space-y-3">
        {state === "loading" && <LoadingCards />}

        {state === "error" && (
          <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-rose-200">
            Failed to load players: {error}
          </div>
        )}

        {state === "success" && rows.length === 0 && (
          <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
            No players found for this filter yet.
          </div>
        )}

        {state === "success" &&
          rows.map((row, index) => (
            <PlayerCard
              key={row.player_id}
              row={row}
              index={index}
              onAddReview={onSelectPlayerForReview}
            />
          ))}
      </section>

      {selectedPlayer && reviewForm && (
        <section className="glass-panel mt-6 rounded-2xl p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-lime-200">
                Submit Review
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">
                {selectedPlayer.player_name} · {selectedPlayer.base_ovr}
              </h2>
              <p className="text-xs text-slate-300">
                Reviews are published after moderation.
              </p>
            </div>
            <button
              type="button"
              onClick={closeReviewPanel}
              className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300"
            >
              Close
            </button>
          </div>

          <form onSubmit={onSubmitReview} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-300">
                Sentiment (1-10)
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={reviewForm.sentimentScore}
                  onChange={onChangeReviewField("sentimentScore")}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <label className="text-xs text-slate-300">
                Played Position
                <input
                  type="text"
                  value={reviewForm.playedPosition}
                  onChange={onChangeReviewField("playedPosition")}
                  placeholder="ST"
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm uppercase text-slate-100 outline-none"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-300">
                Mentioned Rank (optional)
                <select
                  value={reviewForm.mentionedRankText}
                  onChange={onChangeReviewField("mentionedRankText")}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  {RANK_OPTIONS.map((rank) => (
                    <option
                      key={rank || "none"}
                      value={rank}
                      className="bg-slate-900 text-slate-100"
                    >
                      {rank || "Not specified"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-300">
                Username Type (optional)
                <select
                  value={reviewForm.submittedUsernameType}
                  onChange={onChangeReviewField("submittedUsernameType")}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="" className="bg-slate-900 text-slate-100">
                    Anonymous
                  </option>
                  <option value="reddit" className="bg-slate-900 text-slate-100">
                    Reddit username
                  </option>
                  <option value="game" className="bg-slate-900 text-slate-100">
                    In-game username
                  </option>
                </select>
              </label>
            </div>

            <label className="block text-xs text-slate-300">
              Username (optional)
              <input
                type="text"
                value={reviewForm.submittedUsername}
                onChange={onChangeReviewField("submittedUsername")}
                placeholder="Leave blank for anonymous"
                maxLength={32}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>

            <div>
              <p className="mb-2 text-xs text-slate-300">Pros (max 3)</p>
              <div className="flex flex-wrap gap-2">
                {ATTRIBUTE_TAGS.map((tag) => {
                  const active = reviewForm.pros.includes(tag);
                  return (
                    <button
                      key={`pro-${tag}`}
                      type="button"
                      onClick={() => toggleTag("pros", tag, 3)}
                      className={[
                        "rounded-full border px-3 py-1 text-xs font-medium transition",
                        active
                          ? "border-lime-300/60 bg-lime-300/20 text-lime-100"
                          : "border-white/15 bg-white/5 text-slate-300",
                      ].join(" ")}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs text-slate-300">Cons (max 2)</p>
              <div className="flex flex-wrap gap-2">
                {ATTRIBUTE_TAGS.map((tag) => {
                  const active = reviewForm.cons.includes(tag);
                  return (
                    <button
                      key={`con-${tag}`}
                      type="button"
                      onClick={() => toggleTag("cons", tag, 2)}
                      className={[
                        "rounded-full border px-3 py-1 text-xs font-medium transition",
                        active
                          ? "border-rose-300/60 bg-rose-300/20 text-rose-100"
                          : "border-white/15 bg-white/5 text-slate-300",
                      ].join(" ")}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block text-xs text-slate-300">
              Note (optional)
              <textarea
                value={reviewForm.note}
                onChange={onChangeReviewField("note")}
                maxLength={220}
                rows={3}
                placeholder="Quick context about your experience"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>

            {reviewFeedback && (
              <div
                className={[
                  "rounded-xl px-3 py-2 text-sm",
                  reviewFeedback.kind === "success"
                    ? "border border-lime-300/30 bg-lime-300/10 text-lime-100"
                    : "border border-rose-300/30 bg-rose-300/10 text-rose-100",
                ].join(" ")}
              >
                {reviewFeedback.message}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingReview}
              className="w-full rounded-xl bg-accent-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmittingReview ? "Submitting..." : "Submit Review"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
