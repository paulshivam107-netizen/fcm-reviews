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
import Script from "next/script";
import { LegalFooter } from "@/components/legal-footer";
import { LOCAL_MOCK_PLAYERS } from "@/lib/local-mock-data";
import { POSITION_GROUPS, TAB_LABELS, parseTab } from "@/lib/position-groups";
import {
  getReviewTagsForPosition,
  REVIEW_POSITIONS_BY_GROUP,
} from "@/lib/review-attributes";
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
import {
  FeedbackSubmissionResponse,
  UserFeedbackCategory,
} from "@/types/feedback";
import { AdsConfigApiResponse, AdsRuntimeConfig, AdSlotKey } from "@/types/ads";

type FetchState = "idle" | "loading" | "success" | "error";

type ReviewFormState = {
  playerName: string;
  playerOvr: string;
  eventName: string;
  sentimentScore: string;
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

type FeedbackFormState = {
  category: UserFeedbackCategory;
  message: string;
  contact: string;
  honeypot: string;
};

const RANK_OPTIONS = ["", "Base", "Blue", "Purple", "Red", "Gold"] as const;
const FEEDBACK_CATEGORY_OPTIONS: Array<{
  value: UserFeedbackCategory;
  label: string;
  help: string;
}> = [
  {
    value: "review_feedback",
    label: "Review Feedback",
    help: "Quality, clarity, or trust in card reviews.",
  },
  {
    value: "general_feedback",
    label: "General Feedback",
    help: "UI, search experience, performance, or bugs.",
  },
  {
    value: "improvement_suggestion",
    label: "Improvement Suggestion",
    help: "Feature requests and roadmap suggestions.",
  },
];
const CLIENT_FETCH_TIMEOUT_MS = 6000;
const AD_CONFIG_FETCH_TIMEOUT_MS = 4500;
const ADS_PLACEHOLDER_PREVIEW =
  process.env.NEXT_PUBLIC_ENABLE_AD_SLOTS === "true";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const PUBLIC_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://fcm-reviews-production.up.railway.app"
).replace(/\/+$/, "");
const DEFAULT_REVIEW_POSITION_BY_TAB: Record<PlayerTab, string> = {
  attacker: "ST",
  midfielder: "CM",
  defender: "CB",
  goalkeeper: "GK",
};

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

function buildDefaultAdsConfig(): AdsRuntimeConfig {
  return {
    enabled: false,
    provider: "none",
    adsenseClientId: null,
    previewPlaceholders: ADS_PLACEHOLDER_PREVIEW,
    slots: {
      top_banner: { enabled: false, slotId: null },
      in_feed: { enabled: false, slotId: null },
      footer_sticky: { enabled: false, slotId: null },
    },
  };
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
  const hasQuery = parsed.raw.trim().length > 0;
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;
  const allowedPositions = new Set(POSITION_GROUPS[tab]);
  const queryText = parsed.nameQuery.trim().toLowerCase();

  let rows = LOCAL_MOCK_PLAYERS;
  if (!hasQuery && !isOvrOnlyQuery) {
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

function buildInitialReviewForm(
  defaultPosition = "ST",
  prefill?: {
    playerName?: string;
    playerOvr?: string;
    eventName?: string;
  }
): ReviewFormState {
  return {
    playerName: prefill?.playerName ?? "",
    playerOvr: prefill?.playerOvr ?? "",
    eventName: prefill?.eventName ?? "",
    sentimentScore: "8",
    playedPosition: defaultPosition,
    mentionedRankText: "",
    pros: [],
    cons: [],
    note: "",
    honeypot: "",
    submittedUsername: "",
    submittedUsernameType: "",
  };
}

function buildInitialFeedbackForm(): FeedbackFormState {
  return {
    category: "improvement_suggestion",
    message: "",
    contact: "",
    honeypot: "",
  };
}

function normalizePositionInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

function filterTagsForPosition(tags: string[], position: string) {
  const allowed = new Set(getReviewTagsForPosition(position));
  return tags.filter((tag) => allowed.has(tag));
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
    adsbygoogle?: unknown[];
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
  slotKey,
  placement,
  config,
  className,
}: {
  slotKey: AdSlotKey;
  placement: string;
  config: AdsRuntimeConfig;
  className?: string;
}) {
  const slot = config.slots[slotKey];
  const shouldRenderLiveAd =
    config.enabled &&
    config.provider === "adsense" &&
    Boolean(config.adsenseClientId) &&
    slot.enabled &&
    Boolean(slot.slotId);

  useEffect(() => {
    if (!shouldRenderLiveAd) return;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {
      // Do not block page UI if ad script is unavailable.
    }
  }, [shouldRenderLiveAd, slot.slotId]);

  if (!shouldRenderLiveAd && !config.previewPlaceholders) return null;

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
      <p className="mt-1 text-xs text-slate-300">
        {placement}
        {!shouldRenderLiveAd ? " (placeholder)" : ""}
      </p>
      {shouldRenderLiveAd && (
        <ins
          className="adsbygoogle mt-3 block min-h-[56px] w-full overflow-hidden rounded-lg border border-white/10 bg-black/10"
          style={{ display: "block" }}
          data-ad-client={config.adsenseClientId ?? undefined}
          data-ad-slot={slot.slotId ?? undefined}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      )}
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
                    rel="ugc nofollow noopener noreferrer"
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
  const [isFeedbackPanelOpen, setIsFeedbackPanelOpen] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState<FeedbackFormState>(() =>
    buildInitialFeedbackForm()
  );
  const [feedbackResult, setFeedbackResult] = useState<ReviewFeedback | null>(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackCaptchaToken, setFeedbackCaptchaToken] = useState("");
  const [feedbackCaptchaRenderKey, setFeedbackCaptchaRenderKey] = useState(0);
  const [insightReviews, setInsightReviews] = useState<PlayerReviewFeedItem[]>([]);
  const [insightReviewsState, setInsightReviewsState] = useState<FetchState>("idle");
  const [insightReviewsError, setInsightReviewsError] = useState<string | null>(null);
  const [adsConfig, setAdsConfig] = useState<AdsRuntimeConfig>(
    buildDefaultAdsConfig
  );

  const tabList = useMemo(
    () => Object.keys(POSITION_GROUPS).map((tab) => parseTab(tab)),
    []
  );
  const isReviewPanelOpen = reviewForm !== null;
  const isSubmissionPanelOpen = isReviewPanelOpen || isFeedbackPanelOpen;
  const websiteJsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "FC Mobile Reviews",
      url: PUBLIC_SITE_URL,
      description:
        "Community FC Mobile player reviews and sentiment to compare cards quickly.",
      inLanguage: "en",
    }),
    []
  );
  const activeReviewTagOptions = useMemo(
    () =>
      getReviewTagsForPosition(
        reviewForm?.playedPosition ?? selectedPlayer?.base_position ?? "ST"
      ),
    [reviewForm?.playedPosition, selectedPlayer?.base_position]
  );

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      AD_CONFIG_FETCH_TIMEOUT_MS
    );

    async function loadAdsConfig() {
      try {
        const response = await fetch("/api/ads/config", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        const payload = (await response.json()) as AdsConfigApiResponse;
        if (!cancelled && payload?.config) {
          setAdsConfig(payload.config);
        }
      } catch {
        if (!cancelled) {
          setAdsConfig(buildDefaultAdsConfig());
        }
      }
    }

    void loadAdsConfig();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [isHydrated]);

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
    setIsFeedbackPanelOpen(false);
    setFeedbackResult(null);
    setFeedbackCaptchaToken("");
    setSelectedPlayer(player);
    setReviewForm(
      buildInitialReviewForm(player.base_position, {
        playerName: player.player_name,
        playerOvr: String(player.base_ovr),
        eventName: player.program_promo,
      })
    );
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
    setIsFeedbackPanelOpen(false);
    setFeedbackResult(null);
    setFeedbackCaptchaToken("");
    const preferredPlayer = selectedInsightPlayer ?? null;
    const fallbackPosition = DEFAULT_REVIEW_POSITION_BY_TAB[activeTab];
    setSelectedPlayer(preferredPlayer);
    setReviewForm(
      buildInitialReviewForm(
        preferredPlayer?.base_position ?? fallbackPosition,
        preferredPlayer
          ? {
              playerName: preferredPlayer.player_name,
              playerOvr: String(preferredPlayer.base_ovr),
              eventName: preferredPlayer.program_promo,
            }
          : undefined
      )
    );
    setReviewFeedback(null);
    setCaptchaToken("");
    setCaptchaRenderKey((current) => current + 1);
  };

  const closeReviewPanel = () => {
    setSelectedPlayer(null);
    setReviewForm(null);
    setReviewFeedback(null);
    setCaptchaToken("");
  };

  const openFeedbackPanel = () => {
    setSelectedPlayer(null);
    setReviewForm(null);
    setReviewFeedback(null);
    setCaptchaToken("");
    setIsFeedbackPanelOpen(true);
    setFeedbackResult(null);
    setFeedbackCaptchaToken("");
    setFeedbackCaptchaRenderKey((current) => current + 1);
  };

  const closeFeedbackPanel = () => {
    setIsFeedbackPanelOpen(false);
    setFeedbackResult(null);
    setIsSubmittingFeedback(false);
    setFeedbackCaptchaToken("");
  };

  const onChangeFeedbackField =
    <K extends keyof FeedbackFormState>(field: K) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      if (field === "category") {
        setFeedbackForm((current) => ({
          ...current,
          category: nextValue as UserFeedbackCategory,
        }));
        return;
      }
      if (field === "contact") {
        setFeedbackForm((current) => ({
          ...current,
          contact: nextValue.slice(0, 32),
        }));
        return;
      }
      setFeedbackForm((current) => ({ ...current, [field]: nextValue }));
    };

  const onChangeReviewField =
    <K extends keyof ReviewFormState>(field: K) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      if (!reviewForm) return;

      const nextValue = event.target.value;
      if (field === "sentimentScore") {
        const sanitized = nextValue.replace(/[^0-9]/g, "").slice(0, 2);
        setReviewForm({
          ...reviewForm,
          sentimentScore: sanitized,
        });
        return;
      }

      if (field === "playedPosition") {
        const nextPosition = normalizePositionInput(nextValue);
        setReviewForm({
          ...reviewForm,
          playedPosition: nextPosition,
          pros: filterTagsForPosition(reviewForm.pros, nextPosition),
          cons: filterTagsForPosition(reviewForm.cons, nextPosition),
        });
        return;
      }

      if (field === "playerOvr") {
        setReviewForm({
          ...reviewForm,
          playerOvr: nextValue.replace(/[^0-9]/g, "").slice(0, 3),
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
    const allowedTags = new Set(getReviewTagsForPosition(reviewForm.playedPosition));
    if (!allowedTags.has(tag)) return;

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

    if (!reviewForm || isSubmittingReview) {
      return;
    }

    const playerName = reviewForm.playerName.trim();
    if (playerName.length < 2) {
      setReviewFeedback({
        kind: "error",
        message: "Enter player name (minimum 2 characters).",
      });
      return;
    }

    const playerOvr = Number(reviewForm.playerOvr);
    if (!Number.isInteger(playerOvr) || playerOvr < 1 || playerOvr > 130) {
      setReviewFeedback({
        kind: "error",
        message: "Enter a valid OVR between 1 and 130.",
      });
      return;
    }

    const sentimentScore = Number.parseInt(reviewForm.sentimentScore, 10);
    if (!Number.isInteger(sentimentScore) || sentimentScore < 1 || sentimentScore > 10) {
      setReviewFeedback({
        kind: "error",
        message: "Enter integer sentiment between 1 and 10.",
      });
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
          playerName,
          playerOvr,
          eventName: reviewForm.eventName.trim() || null,
          sentimentScore,
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
      setReviewForm(
        buildInitialReviewForm(
          selectedPlayer?.base_position ?? "ST",
          selectedPlayer
            ? {
                playerName: selectedPlayer.player_name,
                playerOvr: String(selectedPlayer.base_ovr),
                eventName: selectedPlayer.program_promo,
              }
            : undefined
        )
      );
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

  const onSubmitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingFeedback) return;

    const message = feedbackForm.message.replace(/\s+/g, " ").trim();
    if (message.length < 12) {
      setFeedbackResult({
        kind: "error",
        message: "Please share at least 12 characters so we have enough context.",
      });
      return;
    }

    if (TURNSTILE_SITE_KEY && !feedbackCaptchaToken) {
      setFeedbackResult({
        kind: "error",
        message: "Please complete the captcha before submitting.",
      });
      return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackResult(null);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: feedbackForm.category,
          message,
          contact: feedbackForm.contact.trim() || null,
          honeypot: feedbackForm.honeypot || null,
          captchaToken: feedbackCaptchaToken || null,
        }),
      });

      const payload = (await response.json()) as
        | FeedbackSubmissionResponse
        | { error?: string; message?: string };

      if (!response.ok) {
        setFeedbackResult({
          kind: "error",
          message:
            "error" in payload && payload.error
              ? payload.error
              : "Could not submit feedback.",
        });
        return;
      }

      setFeedbackResult({
        kind: "success",
        message:
          ("message" in payload && payload.message) ||
          "Feedback submitted. Thanks for helping improve the app.",
      });
      setFeedbackForm(buildInitialFeedbackForm());
      setFeedbackCaptchaToken("");
      setFeedbackCaptchaRenderKey((current) => current + 1);
    } catch {
      setFeedbackResult({
        kind: "error",
        message: "Network error while submitting feedback.",
      });
    } finally {
      setIsSubmittingFeedback(false);
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
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      {adsConfig.enabled &&
        adsConfig.provider === "adsense" &&
        adsConfig.adsenseClientId && (
          <Script
            id="adsense-runtime"
            strategy="afterInteractive"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsConfig.adsenseClientId}`}
            crossOrigin="anonymous"
          />
        )}
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
            Submit for any player card using name + OVR.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={isFeedbackPanelOpen ? closeFeedbackPanel : openFeedbackPanel}
            className="rounded-xl border border-sky-300/35 bg-sky-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-sky-200 transition hover:bg-sky-300/20"
          >
            {isFeedbackPanelOpen ? "Close Feedback" : "Share Feedback"}
          </button>
          <p className="text-xs text-slate-400">
            Report issues, review quality feedback, or feature suggestions.
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
            placeholder="Search player or try “117 Messi”"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </form>

      <AdSlot
        slotKey="top_banner"
        placement="Top Banner (320x50 / 300x250)"
        config={adsConfig}
        className="mb-5"
      />

      <nav
        className="soft-scrollbar mb-6 flex snap-x gap-2 overflow-x-auto overflow-y-visible pb-2"
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
                  ? "tab-active-glow text-slate-950"
                  : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
              ].join(" ")}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>

      {!isSubmissionPanelOpen && <section className="space-y-3">
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
                <AdSlot
                  slotKey="in_feed"
                  placement="In-feed (300x250)"
                  config={adsConfig}
                  className="mt-3"
                />
              )}
            </div>
          ))}
      </section>}

      {reviewForm && (
        <section className="glass-panel mb-6 rounded-2xl p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-lime-200">
                Submit Review
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">
                {selectedPlayer
                  ? `Prefilled: ${selectedPlayer.player_name} · ${selectedPlayer.base_ovr}`
                  : "Any FC Mobile Card"}
              </h2>
              <p className="text-xs text-slate-300">
                {selectedPlayer
                  ? "Edit the fields if you want to submit for a different card."
                  : "Enter player name + OVR. Event is optional."}
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
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 text-xs text-slate-300">
                Player Name
                <input
                  type="text"
                  value={reviewForm.playerName}
                  onChange={onChangeReviewField("playerName")}
                  maxLength={72}
                  placeholder="e.g. Lionel Messi"
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <label className="text-xs text-slate-300">
                OVR
                <input
                  type="text"
                  inputMode="numeric"
                  value={reviewForm.playerOvr}
                  onChange={onChangeReviewField("playerOvr")}
                  placeholder="113"
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>
            </div>

            <label className="block text-xs text-slate-300">
              Event (optional)
              <input
                type="text"
                value={reviewForm.eventName}
                onChange={onChangeReviewField("eventName")}
                maxLength={48}
                placeholder="e.g. TOTY, Icons, Signature"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-300">
                Sentiment (1-10)
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="1-10"
                  value={reviewForm.sentimentScore}
                  onChange={onChangeReviewField("sentimentScore")}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <label className="text-xs text-slate-300">
                Played Position
                <select
                  value={reviewForm.playedPosition}
                  onChange={onChangeReviewField("playedPosition")}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm uppercase text-slate-100 outline-none"
                >
                  <optgroup label="Attacker">
                    {REVIEW_POSITIONS_BY_GROUP.attacker.map((position) => (
                      <option
                        key={position}
                        value={position}
                        className="bg-slate-900 text-slate-100"
                      >
                        {position}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Midfielder">
                    {REVIEW_POSITIONS_BY_GROUP.midfielder.map((position) => (
                      <option
                        key={position}
                        value={position}
                        className="bg-slate-900 text-slate-100"
                      >
                        {position}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Defender">
                    {REVIEW_POSITIONS_BY_GROUP.defender.map((position) => (
                      <option
                        key={position}
                        value={position}
                        className="bg-slate-900 text-slate-100"
                      >
                        {position}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Goalkeeper">
                    {REVIEW_POSITIONS_BY_GROUP.goalkeeper.map((position) => (
                      <option
                        key={position}
                        value={position}
                        className="bg-slate-900 text-slate-100"
                      >
                        {position}
                      </option>
                    ))}
                  </optgroup>
                </select>
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
              <p className="mb-2 text-xs text-slate-300">
                Pros (max 3) based on played position
              </p>
              <div className="flex flex-wrap gap-2">
                {activeReviewTagOptions.map((tag) => {
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
              <p className="mb-2 text-xs text-slate-300">
                Cons (max 2) based on played position
              </p>
              <div className="flex flex-wrap gap-2">
                {activeReviewTagOptions.map((tag) => {
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

      {isFeedbackPanelOpen && (
        <section className="glass-panel mb-6 rounded-2xl p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-sky-200">
                Product Feedback
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-100">
                Help Improve FC Mobile Reviews
              </h2>
              <p className="text-xs text-slate-300">
                Share review quality feedback, bugs, or feature suggestions.
              </p>
            </div>
            <button
              type="button"
              onClick={closeFeedbackPanel}
              className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300"
            >
              Close
            </button>
          </div>

          <form onSubmit={onSubmitFeedback} className="relative space-y-4">
            <label className="block text-xs text-slate-300">
              Feedback type
              <select
                value={feedbackForm.category}
                onChange={onChangeFeedbackField("category")}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-400">
                {
                  FEEDBACK_CATEGORY_OPTIONS.find(
                    (option) => option.value === feedbackForm.category
                  )?.help
                }
              </span>
            </label>

            <label className="block text-xs text-slate-300">
              Message
              <textarea
                value={feedbackForm.message}
                onChange={onChangeFeedbackField("message")}
                maxLength={1200}
                rows={5}
                placeholder="Tell us what should change, what is not working, or what we should build next."
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>

            <label className="block text-xs text-slate-300">
              Contact (optional)
              <input
                type="text"
                value={feedbackForm.contact}
                onChange={onChangeFeedbackField("contact")}
                maxLength={32}
                placeholder="Reddit or in-game username"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>

            <div
              aria-hidden
              className="pointer-events-none absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden opacity-0"
            >
              <label htmlFor="feedback-website-field">Website</label>
              <input
                id="feedback-website-field"
                type="text"
                autoComplete="off"
                tabIndex={-1}
                value={feedbackForm.honeypot}
                onChange={onChangeFeedbackField("honeypot")}
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
              <p className="mb-2 text-xs text-slate-300">Spam protection</p>
              <TurnstileField
                key={feedbackCaptchaRenderKey}
                siteKey={TURNSTILE_SITE_KEY}
                onTokenChange={setFeedbackCaptchaToken}
              />
            </div>

            {feedbackResult && (
              <div
                className={[
                  "rounded-xl px-3 py-2 text-sm",
                  feedbackResult.kind === "success"
                    ? "border border-lime-300/30 bg-lime-300/10 text-lime-100"
                    : "border border-rose-300/30 bg-rose-300/10 text-rose-100",
                ].join(" ")}
              >
                {feedbackResult.message}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingFeedback}
              className="w-full rounded-xl border border-sky-300/35 bg-sky-300/12 px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmittingFeedback ? "Submitting..." : "Submit Feedback"}
            </button>
          </form>
        </section>
      )}

      <AdSlot
        slotKey="footer_sticky"
        placement="Footer Sticky (320x50)"
        config={adsConfig}
        className="mt-6"
      />
      <LegalFooter />
    </main>
  );
}
