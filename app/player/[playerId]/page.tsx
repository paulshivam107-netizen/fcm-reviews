"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LegalFooter } from "@/components/legal-footer";
import { buildPlaystyleInsights } from "@/lib/playstyle-insights";
import { POSITION_GROUPS } from "@/lib/position-groups";
import {
  PlayerApiResponse,
  PlayerInsightTerm,
  PlayerRow,
  PlayerTab,
} from "@/types/player";
import { PlayerReviewFeedItem, PlayerReviewsApiResponse } from "@/types/review";

type FetchState = "idle" | "loading" | "success" | "error";
const PUBLIC_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://fcm-reviews-production.up.railway.app"
).replace(/\/+$/, "");

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function formatSentiment(score: number | null) {
  if (score === null || Number.isNaN(score)) return "N/A";
  return `${score.toFixed(1)}/10`;
}

function formatReviewCount(count: number | null | undefined) {
  const safeCount = Math.max(0, Number(count ?? 0));
  if (safeCount === 1) return "1 review";
  return `${safeCount} reviews`;
}

function formatCommunityRating(score: number | null, count: number | null | undefined) {
  const safeCount = Math.max(0, Number(count ?? 0));
  if (score === null || Number.isNaN(score)) {
    if (safeCount > 0) return `No rating yet · ${formatReviewCount(safeCount)}`;
    return "No rating yet";
  }
  return `${score.toFixed(1)}/10 · ${formatReviewCount(safeCount)}`;
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

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function getPlayerTabForPosition(position: string): PlayerTab {
  const normalized = position.trim().toUpperCase();
  const matchedEntry = (Object.entries(POSITION_GROUPS) as Array<[PlayerTab, string[]]>).find(
    ([, positions]) => positions.includes(normalized)
  );
  return matchedEntry?.[0] ?? "attacker";
}

function buildCommunityVerdict(args: {
  player: PlayerRow;
  pros: PlayerInsightTerm[];
  cons: PlayerInsightTerm[];
}) {
  const { player, pros, cons } = args;
  const reviewCount = Math.max(0, Number(player.mention_count ?? 0));
  const topPros = pros.slice(0, 3).map((term) => term.text);
  const topCons = cons.slice(0, 2).map((term) => term.text);
  const sentiment = Number(player.avg_sentiment_score ?? NaN);
  const hasSentiment = Number.isFinite(sentiment);

  if (reviewCount === 0) {
    return "Not enough reviews yet for a full verdict.";
  }

  if (topPros.length > 0 && topCons.length > 0) {
    return `Community likes ${formatList(topPros.slice(0, 2))}, but mentions ${formatList(
      topCons.slice(0, 1)
    )}.`;
  }

  if (topPros.length >= 2) {
    if (hasSentiment && sentiment >= 8.5) {
      return `Highly rated card with strong ${formatList(topPros.slice(0, 3))}.`;
    }
    return `Early community feedback highlights ${formatList(topPros.slice(0, 2))}.`;
  }

  if (topPros.length === 1) {
    return `Early community feedback highlights ${topPros[0]}.`;
  }

  if (topCons.length > 0) {
    return `Community feedback is still limited, but ${formatList(
      topCons.slice(0, 1)
    )} is mentioned as a weakness.`;
  }

  if (reviewCount <= 2) {
    return "Early community feedback is in, but more reviews will sharpen the verdict.";
  }

  return "Community feedback is building, but no clear consensus has formed yet.";
}

function sourceBadgeClass(source: PlayerReviewFeedItem["sourcePlatform"]) {
  return source === "reddit"
    ? "border-lime-300/40 bg-lime-300/12 text-lime-100"
    : "border-sky-300/40 bg-sky-300/12 text-sky-100";
}

function getReviewDisplayName(review: PlayerReviewFeedItem) {
  const label = review.sourceLabel.trim();
  if (review.sourcePlatform === "user" && label.toLowerCase() === "web user") {
    return "Community member";
  }
  return label || (review.sourcePlatform === "reddit" ? "Reddit source" : "Community member");
}

function getReviewSourceLabel(review: PlayerReviewFeedItem) {
  return review.sourcePlatform === "reddit" ? "Reddit-sourced" : "Web submission";
}

function buildAddReviewHref(player: PlayerRow) {
  const params = new URLSearchParams({
    addReview: "1",
    playerName: player.player_name,
    playerOvr: String(player.base_ovr),
    eventName: player.program_promo,
    playedPosition: player.base_position,
  });
  return `/?${params.toString()}`;
}

function buildCompareHref(player: PlayerRow) {
  const params = new URLSearchParams({
    left: player.player_id,
  });
  return `/compare?${params.toString()}`;
}

function QuickRecommendCard({ playerId }: { playerId: string }) {
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(`card-recommendation:${playerId}`);
    if (stored === "yes" || stored === "no") {
      setChoice(stored);
    }
  }, [playerId]);

  const setRecommendation = (nextChoice: "yes" | "no") => {
    setChoice(nextChoice);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`card-recommendation:${playerId}`, nextChoice);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            Would you recommend this card?
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Quick signal only. This does not affect the public rating yet.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setRecommendation("yes")}
            className={[
              "rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition",
              choice === "yes"
                ? "border-lime-300/45 bg-lime-300/18 text-lime-100"
                : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
            ].join(" ")}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setRecommendation("no")}
            className={[
              "rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition",
              choice === "no"
                ? "border-rose-300/45 bg-rose-300/18 text-rose-100"
                : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
            ].join(" ")}
          >
            No
          </button>
        </div>
      </div>
      {choice && (
        <p className="mt-2 text-[11px] text-slate-400">Saved on this device.</p>
      )}
    </div>
  );
}

export default function PlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const playerId = String(params?.playerId ?? "").trim();
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [reviews, setReviews] = useState<PlayerReviewFeedItem[]>([]);
  const [relatedRows, setRelatedRows] = useState<PlayerRow[]>([]);
  const [relatedState, setRelatedState] = useState<FetchState>("idle");
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const validPlayerId = useMemo(() => isUuidLike(playerId), [playerId]);
  const pros = normalizeInsightTerms(player?.top_pros);
  const cons = normalizeInsightTerms(player?.top_cons);
  const reviewCount = Math.max(0, Number(player?.mention_count ?? 0));
  const bestForInsights = useMemo(() => buildPlaystyleInsights(pros), [pros]);
  const weakForInsights = useMemo(() => buildPlaystyleInsights(cons), [cons]);
  const showPlaystyleFallback =
    reviewCount < 3 || (bestForInsights.length === 0 && weakForInsights.length === 0);
  const detailTab = useMemo(
    () => getPlayerTabForPosition(player?.base_position ?? "ST"),
    [player?.base_position]
  );
  const verdict = useMemo(
    () =>
      player
        ? buildCommunityVerdict({
            player,
            pros,
            cons,
          })
        : "",
    [player, pros, cons]
  );
  const playerJsonLd = useMemo(() => {
    if (!player) return null;

    const mentionCount = Number(player.mention_count ?? 0);
    const sentiment = Number(player.avg_sentiment_score ?? NaN);
    const hasRating = mentionCount > 0 && Number.isFinite(sentiment);

    const payload: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: `${player.player_name} ${player.base_ovr} ${player.base_position}`,
      category: "FC Mobile Player Card",
      brand: {
        "@type": "Brand",
        name: "EA SPORTS FC Mobile",
      },
      url: `${PUBLIC_SITE_URL}/player/${player.player_id}`,
      description: `${player.program_promo} card community sentiment and user reviews.`,
    };

    if (hasRating) {
      payload.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: Number(sentiment.toFixed(2)),
        bestRating: 10,
        worstRating: 1,
        ratingCount: mentionCount,
      };
    }

    return payload;
  }, [player]);

  useEffect(() => {
    if (!validPlayerId) {
      setState("error");
      setError("Invalid player URL.");
      return;
    }

    let cancelled = false;

    async function load() {
      setState("loading");
      setError(null);

      try {
        const [playerResponse, reviewsResponse] = await Promise.all([
          fetch(`/api/player/${playerId}`, { cache: "no-store" }),
          fetch(`/api/player-reviews?playerId=${playerId}&limit=20`, {
            cache: "no-store",
          }),
        ]);

        if (!playerResponse.ok) {
          throw new Error(`Player request failed (${playerResponse.status})`);
        }
        if (!reviewsResponse.ok) {
          throw new Error(`Reviews request failed (${reviewsResponse.status})`);
        }

        const playerPayload = (await playerResponse.json()) as PlayerApiResponse;
        const reviewPayload = (await reviewsResponse.json()) as PlayerReviewsApiResponse;

        if (!cancelled) {
          setPlayer(playerPayload.item);
          setReviews(reviewPayload.items);
          setState("success");
          void fetch("/api/track", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              eventType: "card_opened",
              playerId,
              metadata: { surface: "player_page" },
            }),
          }).catch(() => undefined);
        }
      } catch (loadError) {
        if (cancelled) return;
        setPlayer(null);
        setReviews([]);
        setState("error");
        setError(loadError instanceof Error ? loadError.message : "Unknown error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [playerId, validPlayerId]);

  useEffect(() => {
    if (!player) {
      setRelatedRows([]);
      setRelatedState("idle");
      return;
    }
    const currentPlayer = player;

    let cancelled = false;
    const controller = new AbortController();

    async function loadRelated() {
      setRelatedState("loading");
      try {
        const params = new URLSearchParams({
          tab: detailTab,
          limit: "24",
        });
        const response = await fetch(`/api/players?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Related request failed (${response.status})`);
        }

        const payload = (await response.json()) as { items: PlayerRow[] };
        const candidates = payload.items
          .filter((row) => row.player_id !== currentPlayer.player_id)
          .sort((a, b) => {
            const samePositionA = a.base_position === currentPlayer.base_position ? 0 : 1;
            const samePositionB = b.base_position === currentPlayer.base_position ? 0 : 1;
            if (samePositionA !== samePositionB) return samePositionA - samePositionB;

            const ovrDeltaA = Math.abs(a.base_ovr - currentPlayer.base_ovr);
            const ovrDeltaB = Math.abs(b.base_ovr - currentPlayer.base_ovr);
            if (ovrDeltaA !== ovrDeltaB) return ovrDeltaA - ovrDeltaB;

            const sameProgramA = a.program_promo === currentPlayer.program_promo ? 0 : 1;
            const sameProgramB = b.program_promo === currentPlayer.program_promo ? 0 : 1;
            if (sameProgramA !== sameProgramB) return sameProgramA - sameProgramB;

            const scoreA = a.avg_sentiment_score ?? -1;
            const scoreB = b.avg_sentiment_score ?? -1;
            if (scoreA !== scoreB) return scoreB - scoreA;

            if (a.mention_count !== b.mention_count) {
              return b.mention_count - a.mention_count;
            }

            return a.player_name.localeCompare(b.player_name);
          })
          .slice(0, 4);

        if (!cancelled) {
          setRelatedRows(candidates);
          setRelatedState("success");
        }
      } catch {
        if (cancelled) return;
        setRelatedRows([]);
        setRelatedState("error");
      }
    }

    void loadRelated();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detailTab, player]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-28 pt-7 sm:px-6 sm:pb-12">
      <header className="mb-5">
        <Link
          href="/"
          className="mb-3 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
        >
          Back
        </Link>
        <p className="text-xs uppercase tracking-[0.14em] text-lime-200">
          Card Detail
        </p>
      </header>

      {state === "loading" && (
        <div className="space-y-3">
          <div className="glass-panel h-32 animate-pulse rounded-2xl border border-white/10" />
          <div className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10" />
          <div className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10" />
        </div>
      )}

      {state === "error" && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-rose-200">
          Failed to load card: {error ?? "Unknown error"}
        </div>
      )}

      {state === "success" && player && (
        <>
          {playerJsonLd && (
            <script
              type="application/ld+json"
              suppressHydrationWarning
              dangerouslySetInnerHTML={{ __html: JSON.stringify(playerJsonLd) }}
            />
          )}
          <section className="glass-panel rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-slate-100">
                  {player.player_name}
                </h1>
                <p className="mt-1 text-sm text-slate-300">
                  OVR {player.base_ovr} · {player.base_position}
                </p>
              </div>
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                {player.program_promo}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                  Community Rating
                </p>
                <p className="mt-1 text-sm font-semibold text-lime-200">
                  {formatCommunityRating(player.avg_sentiment_score, reviewCount)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                  Review Count
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-100">
                  {reviewCount}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">
                  Last Updated
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-100">
                  {formatWhen(player.last_processed_at)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-lime-300/15 bg-lime-300/6 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200">
                Community Verdict
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-200">{verdict}</p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-lime-200">
                    Most Mentioned Strengths
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
                      <p className="text-xs text-slate-400">
                        No standout strengths have surfaced yet.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-rose-200">
                    Most Mentioned Weaknesses
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
                      <p className="text-xs text-slate-400">
                        No major weaknesses highlighted yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-100"
                    title="Derived from community reviews"
                  >
                    Playstyle Insights
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Quick read on how this card tends to feel in-game.
                  </p>
                </div>
                <span
                  title="Derived from community reviews"
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400"
                >
                  Community-derived
                </span>
              </div>

              {showPlaystyleFallback && (
                <p className="mt-3 text-xs text-slate-400">
                  Not enough reviews yet for full playstyle insights.
                </p>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-lime-200">
                    Best For
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {bestForInsights.length > 0 ? (
                      bestForInsights.map((item) => (
                        <span
                          key={`best-for-${item.label}`}
                          className="inline-flex items-center gap-1 rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-xs text-lime-100"
                        >
                          <span aria-hidden="true">✓</span>
                          <span>{item.label}</span>
                        </span>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">
                        No clear strengths mapped yet.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-amber-200">
                    Weak For
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {weakForInsights.length > 0 ? (
                      weakForInsights.map((item) => (
                        <span
                          key={`weak-for-${item.label}`}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs text-amber-100"
                        >
                          <span aria-hidden="true">⚠</span>
                          <span>{item.label}</span>
                        </span>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">
                        No major weak playstyles highlighted yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Link
                href={buildAddReviewHref(player)}
                className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
              >
                Add Your Review
              </Link>
              <Link
                href={buildCompareHref(player)}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
              >
                Compare With Another Card
              </Link>
            </div>

            <div className="mt-4">
              <QuickRecommendCard playerId={player.player_id} />
            </div>
          </section>

          <section className="mt-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
              Latest Reviews
            </h2>
            {reviews.length === 0 && (
              <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
                No approved reviews available yet.
              </div>
            )}

            {reviews.map((review) => (
              <article
                key={review.id}
                className="glass-panel rounded-2xl border border-white/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {getReviewDisplayName(review)}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      {getReviewSourceLabel(review)} · {formatWhen(review.submittedAt)}
                      {review.playedPosition ? ` · ${review.playedPosition}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={[
                        "rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                        sourceBadgeClass(review.sourcePlatform),
                      ].join(" ")}
                    >
                      {review.sourcePlatform === "reddit"
                        ? "Reddit-sourced"
                        : "Community review"}
                    </span>
                    <p className="mt-2 text-xs font-semibold text-lime-200">
                      {formatSentiment(review.sentimentScore)}
                    </p>
                  </div>
                </div>

                {review.summary && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-200">
                    {review.summary}
                  </p>
                )}

                {review.sourceUrl && (
                  <a
                    href={review.sourceUrl}
                    target="_blank"
                    rel="ugc nofollow noopener noreferrer"
                    className="mt-3 inline-block text-xs font-medium text-lime-200 underline-offset-2 hover:underline"
                  >
                    Open source
                  </a>
                )}
              </article>
            ))}
          </section>

          <section className="mt-5 space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
                  Similar Cards
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Nearby options in the same role and OVR range.
                </p>
              </div>
              <Link
                href={buildCompareHref(player)}
                className="text-xs font-semibold uppercase tracking-[0.08em] text-lime-200 transition hover:text-lime-100"
              >
                Compare more
              </Link>
            </div>

            {relatedState === "loading" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`related-loading-${index}`}
                    className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10"
                  />
                ))}
              </div>
            )}

            {relatedState !== "loading" && relatedRows.length === 0 && (
              <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
                Similar cards will appear here as more same-role review data comes in.
              </div>
            )}

            {relatedRows.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {relatedRows.map((row) => (
                  <Link
                    key={`related-${row.player_id}`}
                    href={`/player/${row.player_id}`}
                    className="glass-panel rounded-2xl border border-white/10 p-4 transition hover:border-lime-300/40 hover:bg-white/7"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100">
                          {row.player_name}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          OVR {row.base_ovr} · {row.base_position}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-300">
                        {row.program_promo}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-lime-200">
                        {formatCommunityRating(row.avg_sentiment_score, row.mention_count)}
                      </p>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        View card
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <LegalFooter />

      {state === "success" && player && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:hidden">
          <div className="pointer-events-auto mx-auto w-full max-w-screen-sm">
            <Link
              href={buildAddReviewHref(player)}
              className="block rounded-xl border border-lime-300/35 bg-lime-300/14 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/22"
            >
              Add Your Review
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
