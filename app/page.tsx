"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";
import { LOCAL_MOCK_PLAYERS } from "@/lib/local-mock-data";
import { POSITION_GROUPS, TAB_LABELS, parseTab } from "@/lib/position-groups";
import { parsePlayerSearch } from "@/lib/search";
import {
  PlayerInsightTerm,
  PlayersApiResponse,
  PlayerRow,
  PlayerTab,
} from "@/types/player";
import {
  PlayerReviewFeedItem,
  PlayerReviewsApiResponse,
  SubmittedUsernameType,
} from "@/types/review";

type FetchState = "idle" | "loading" | "success" | "error";

type ReviewFormState = {
  sentimentScore: number;
  playedPosition: string;
  mentionedRankText: string;
  pros: string[];
  cons: string[];
  note: string;
  honeypot: string;
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
const CLIENT_FETCH_TIMEOUT_MS = 6000;
const ADS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_AD_SLOTS === "true";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

function formatSentiment(score: number | null) {
  if (score === null || Number.isNaN(score)) return "N/A";
  return `${score.toFixed(1)}/10`;
}

function formatLastProcessedAt(timestamp: string | null) {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function summarizeReviewText(text: string | null, maxChars = 220) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "No summary available for this review yet.";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}...`;
}

function normalizeInsightTerms(terms: PlayerInsightTerm[] | undefined) {
  if (!Array.isArray(terms)) return [];
  return terms.filter(
    (term) =>
      term &&
      typeof term.text === "string" &&
      term.text.trim().length > 0 &&
      Number.isFinite(term.count)
  );
}

function queryClientMockPlayers(tab: PlayerTab, query: string, limit = 30) {
  const parsed = parsePlayerSearch(query);
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;
  const allowedPositions = new Set(POSITION_GROUPS[tab]);
  const queryText = parsed.nameQuery.trim().toLowerCase();

  let rows = LOCAL_MOCK_PLAYERS;
  if (!isOvrOnlyQuery) {
    rows = rows.filter((row) => allowedPositions.has(row.base_position));
  }
  if (parsed.requestedOvr !== null) {
    rows = rows.filter((row) => row.base_ovr === parsed.requestedOvr);
  }
  if (queryText) {
    rows = rows.filter((row) => row.player_name.toLowerCase().includes(queryText));
  }

  rows.sort((a, b) => {
    const scoreA = a.avg_sentiment_score ?? -1;
    const scoreB = b.avg_sentiment_score ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    if (a.mention_count !== b.mention_count) return b.mention_count - a.mention_count;
    return b.base_ovr - a.base_ovr;
  });

  return rows.slice(0, limit);
}

function buildInitialReviewForm(player: PlayerRow): ReviewFormState {
  return {
    sentimentScore: 8,
    playedPosition: player.base_position,
    mentionedRankText: "",
    pros: [],
    cons: [],
    note: "",
    honeypot: "",
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

function sourceBadgeClass(source: PlayerReviewFeedItem["sourcePlatform"]) {
  return source === "reddit"
    ? "border-lime-300/40 bg-lime-300/12 text-lime-100"
    : "border-sky-300/40 bg-sky-300/12 text-sky-100";
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

type TurnstileApi = {
  render: (
    container: string | HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
    }
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function TurnstileField({
  siteKey,
  onTokenChange,
}: {
  siteKey: string;
  onTokenChange: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) {
      onTokenChange("");
      return;
    }

    let cancelled = false;

    const ensureScript = () =>
      new Promise<void>((resolve, reject) => {
        if (window.turnstile) {
          resolve();
          return;
        }

        const existing = document.querySelector<HTMLScriptElement>(
          "script[data-turnstile='true']"
        );
        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener(
            "error",
            () => reject(new Error("Failed to load Turnstile script.")),
            { once: true }
          );
          return;
        }

        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = "true";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Failed to load Turnstile script."));
        document.head.appendChild(script);
      });

    async function mountWidget() {
      try {
        await ensureScript();
        if (cancelled || !containerRef.current || !window.turnstile) return;

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenChange(token),
          "expired-callback": () => onTokenChange(""),
          "error-callback": () => onTokenChange(""),
          theme: "dark",
        });
      } catch {
        onTokenChange("");
      }
    }

    mountWidget();

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, onTokenChange]);

  if (!siteKey) {
    return (
      <p className="text-[11px] text-slate-500">
        Captcha is disabled for local environment.
      </p>
    );
  }

  return <div ref={containerRef} />;
}

function AdSlot({
  placement,
  className,
}: {
  placement: string;
  className?: string;
}) {
  if (!ADS_ENABLED) return null;

  return (
    <aside
      aria-label={`Ad slot ${placement}`}
      className={[
        "glass-panel rounded-2xl border border-dashed border-white/20 px-4 py-4 text-center",
        className ?? "",
      ].join(" ")}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
        Sponsored Placement
      </p>
      <p className="mt-1 text-xs text-slate-300">{placement}</p>
    </aside>
  );
}

function PlayerCard({
  row,
  index,
  onOpenInsights,
  onAddReview,
}: {
  row: PlayerRow;
  index: number;
  onOpenInsights: (player: PlayerRow) => void;
  onAddReview: (player: PlayerRow) => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenInsights(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenInsights(row);
        }
      }}
      className="glass-panel card-reveal cursor-pointer rounded-2xl p-4 transition duration-300 hover:border-lime-300/50 focus:outline-none focus:ring-2 focus:ring-lime-300/50"
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
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddReview(row);
            }}
            className="rounded-xl border border-lime-300/35 bg-lime-300/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
          >
            Add Review
          </button>
          <Link
            href={`/player/${row.player_id}`}
            onClick={(event) => event.stopPropagation()}
            className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
          >
            View Card
          </Link>
        </div>
      </div>
    </article>
  );
}

function InsightPanel({
  player,
  reviews,
  reviewsState,
  reviewsError,
  onClose,
  onAddReview,
}: {
  player: PlayerRow;
  reviews: PlayerReviewFeedItem[];
  reviewsState: FetchState;
  reviewsError: string | null;
  onClose: () => void;
  onAddReview: (player: PlayerRow) => void;
}) {
  const pros = normalizeInsightTerms(player.top_pros);
  const cons = normalizeInsightTerms(player.top_cons);

  return (
    <section className="glass-panel mt-3 rounded-2xl p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-lime-200">
            Card Rating
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">
            {player.player_name} · {player.base_ovr}
          </h2>
          <p className="text-xs text-slate-300">
            Community + system summary for this card.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-3">
          <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
            Sentiment
          </p>
          <p className="mt-1 text-sm font-semibold text-lime-200">
            {formatSentiment(player.avg_sentiment_score)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-3">
          <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
            Mentions
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {player.mention_count}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-3">
          <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
            Last Update
          </p>
          <p className="mt-1 text-xs font-medium text-slate-200">
            {formatLastProcessedAt(player.last_processed_at)}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-lime-200">
            Top Pros
          </p>
          <div className="flex flex-wrap gap-2">
            {pros.length ? (
              pros.map((term) => (
                <span
                  key={`pro-${term.text}`}
                  className="rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-xs text-lime-100"
                >
                  {term.text} ({term.count})
                </span>
              ))
            ) : (
              <p className="text-xs text-slate-400">No pro highlights yet.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-rose-200">
            Top Cons
          </p>
          <div className="flex flex-wrap gap-2">
            {cons.length ? (
              cons.map((term) => (
                <span
                  key={`con-${term.text}`}
                  className="rounded-full border border-rose-300/30 bg-rose-300/10 px-3 py-1 text-xs text-rose-100"
                >
                  {term.text} ({term.count})
                </span>
              ))
            ) : (
              <p className="text-xs text-slate-400">No con highlights yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Latest Reviews
        </p>

        {reviewsState === "loading" && (
          <p className="text-xs text-slate-400">Loading latest review feed...</p>
        )}

        {reviewsState === "error" && (
          <p className="text-xs text-rose-200">
            Could not load latest reviews: {reviewsError ?? "Unknown error"}
          </p>
        )}

        {reviewsState === "success" && reviews.length === 0 && (
          <p className="text-xs text-slate-400">No approved reviews available yet.</p>
        )}

        {reviewsState === "success" && reviews.length > 0 && (
          <div className="space-y-2">
            {reviews.map((review) => (
              <article
                key={review.id}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-300">
                      {review.sourceLabel}
                      {review.playedPosition ? ` • ${review.playedPosition}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {formatLastProcessedAt(review.submittedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={[
                        "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                        sourceBadgeClass(review.sourcePlatform),
                      ].join(" ")}
                    >
                      {review.sourcePlatform === "reddit" ? "Reddit" : "Web User"}
                    </span>
                    <p className="mt-1 text-xs font-semibold text-lime-200">
                      {formatSentiment(review.sentimentScore)}
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-200">
                  {summarizeReviewText(review.summary)}
                </p>

                {review.sourceUrl && (
                  <a
                    href={review.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs font-medium text-lime-200 underline-offset-2 hover:underline"
                  >
                    Open source
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onAddReview(player)}
        className="mt-4 w-full rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
      >
        Add Review For This Card
      </button>
      <Link
        href={`/player/${player.player_id}`}
        className="mt-2 block w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
      >
        Open Full Card Page
      </Link>
    </section>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<PlayerTab>("attacker");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [selectedInsightPlayer, setSelectedInsightPlayer] = useState<PlayerRow | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewFormState | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<ReviewFeedback | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaRenderKey, setCaptchaRenderKey] = useState(0);
  const [insightReviews, setInsightReviews] = useState<PlayerReviewFeedItem[]>([]);
  const [insightReviewsState, setInsightReviewsState] = useState<FetchState>("idle");
  const [insightReviewsError, setInsightReviewsError] = useState<string | null>(null);

  const tabList = useMemo(
    () => Object.keys(POSITION_GROUPS).map((tab) => parseTab(tab)),
    []
  );
  const reviewPlayerOptions = rows.length ? rows : LOCAL_MOCK_PLAYERS;

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CLIENT_FETCH_TIMEOUT_MS
    );

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
        const fallbackRows = queryClientMockPlayers(activeTab, query);
        if (fallbackRows.length > 0) {
          setRows(fallbackRows);
          setState("success");
          setError(null);
          return;
        }

        setState("error");
        if (err instanceof Error && err.name === "AbortError") {
          setError("Request timed out. Please refresh or try again.");
          return;
        }

        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [isHydrated, activeTab, query]);

  useEffect(() => {
    const playerId = selectedInsightPlayer?.player_id;
    if (!playerId) {
      setInsightReviews([]);
      setInsightReviewsState("idle");
      setInsightReviewsError(null);
      return;
    }
    const activePlayerId = playerId;

    let cancelled = false;
    const controller = new AbortController();

    async function loadInsightReviews() {
      setInsightReviewsState("loading");
      setInsightReviewsError(null);

      try {
        const params = new URLSearchParams({
          playerId: activePlayerId,
          limit: "5",
        });
        const response = await fetch(`/api/player-reviews?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as PlayerReviewsApiResponse;
        if (!cancelled) {
          setInsightReviews(payload.items);
          setInsightReviewsState("success");
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === "AbortError") return;

        setInsightReviews([]);
        setInsightReviewsState("error");
        setInsightReviewsError(
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    }

    loadInsightReviews();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedInsightPlayer?.player_id]);

  const onSubmitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = queryDraft.trim();
    setQuery(nextQuery);
    if (nextQuery) {
      void fetch("/api/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType: "search_submitted",
          queryText: nextQuery,
          metadata: {
            tab: activeTab,
          },
        }),
      }).catch(() => undefined);
    }
  };

  const onSelectPlayerForReview = (player: PlayerRow) => {
    setSelectedPlayer(player);
    setReviewForm(buildInitialReviewForm(player));
    setReviewFeedback(null);
    setCaptchaToken("");
    setCaptchaRenderKey((current) => current + 1);
  };

  const onSelectPlayerForInsights = (player: PlayerRow) => {
    setSelectedInsightPlayer((current) =>
      current?.player_id === player.player_id ? null : player
    );
    if (selectedInsightPlayer?.player_id !== player.player_id) {
      void fetch("/api/track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType: "card_opened",
          playerId: player.player_id,
          metadata: {
            surface: "home_card",
            tab: activeTab,
          },
        }),
      }).catch(() => undefined);
    }
  };

  const onOpenGlobalAddReview = () => {
    onSelectPlayerForReview(
      selectedPlayer ?? selectedInsightPlayer ?? reviewPlayerOptions[0]
    );
  };

  const onChangeReviewPlayer = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextPlayer = reviewPlayerOptions.find(
      (row) => row.player_id === event.target.value
    );
    if (!nextPlayer) return;
    onSelectPlayerForReview(nextPlayer);
  };

  const closeReviewPanel = () => {
    setSelectedPlayer(null);
    setReviewForm(null);
    setReviewFeedback(null);
    setCaptchaToken("");
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

    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setReviewFeedback({
        kind: "error",
        message: "Please complete the captcha before submitting.",
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
          honeypot: reviewForm.honeypot || null,
          captchaToken: captchaToken || null,
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
      setCaptchaToken("");
      setCaptchaRenderKey((current) => current + 1);
    } catch {
      setReviewFeedback({
        kind: "error",
        message: "Network error while submitting review.",
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  if (!isHydrated) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
        <LoadingCards />
      </main>
    );
  }

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
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenGlobalAddReview}
            className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
          >
            Add Review
          </button>
          <p className="text-xs text-slate-400">
            Don&apos;t see your player? search first, then submit.
          </p>
        </div>
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

      <AdSlot placement="Top Banner (320x50 / 300x250)" className="mb-5" />

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
            <div key={row.player_id}>
              <PlayerCard
                row={row}
                index={index}
                onOpenInsights={onSelectPlayerForInsights}
                onAddReview={onSelectPlayerForReview}
              />
              {selectedInsightPlayer?.player_id === row.player_id && (
                <InsightPanel
                  player={row}
                  reviews={insightReviews}
                  reviewsState={insightReviewsState}
                  reviewsError={insightReviewsError}
                  onClose={() => setSelectedInsightPlayer(null)}
                  onAddReview={onSelectPlayerForReview}
                />
              )}
              {index === 2 && (
                <AdSlot placement="In-feed (300x250)" className="mt-3" />
              )}
            </div>
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

          <form onSubmit={onSubmitReview} className="relative space-y-4">
            <label className="block text-xs text-slate-300">
              Player
              <select
                value={selectedPlayer.player_id}
                onChange={onChangeReviewPlayer}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                {reviewPlayerOptions.map((row) => (
                  <option
                    key={row.player_id}
                    value={row.player_id}
                    className="bg-slate-900 text-slate-100"
                  >
                    {row.player_name} · {row.base_ovr} · {row.base_position}
                  </option>
                ))}
              </select>
            </label>

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

            <div aria-hidden className="pointer-events-none absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden opacity-0">
              <label htmlFor="website-field">Website</label>
              <input
                id="website-field"
                type="text"
                autoComplete="off"
                tabIndex={-1}
                value={reviewForm.honeypot}
                onChange={onChangeReviewField("honeypot")}
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
              <p className="mb-2 text-xs text-slate-300">Spam protection</p>
              <TurnstileField
                key={captchaRenderKey}
                siteKey={TURNSTILE_SITE_KEY}
                onTokenChange={setCaptchaToken}
              />
            </div>

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

      <AdSlot placement="Footer Sticky (320x50)" className="mt-6" />
      <LegalFooter />
    </main>
  );
}
