"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LegalFooter } from "@/components/legal-footer";
import { PlayerApiResponse, PlayerInsightTerm, PlayerRow } from "@/types/player";
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

function sourceBadgeClass(source: PlayerReviewFeedItem["sourcePlatform"]) {
  return source === "reddit"
    ? "border-lime-300/40 bg-lime-300/12 text-lime-100"
    : "border-sky-300/40 bg-sky-300/12 text-sky-100";
}

export default function PlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const playerId = String(params?.playerId ?? "").trim();
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [reviews, setReviews] = useState<PlayerReviewFeedItem[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const validPlayerId = useMemo(() => isUuidLike(playerId), [playerId]);
  const pros = normalizeInsightTerms(player?.top_pros);
  const cons = normalizeInsightTerms(player?.top_cons);
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
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
                  Updated
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-100">
                  {formatWhen(player.last_processed_at)}
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
                      {review.sourceLabel}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      {formatWhen(review.submittedAt)}
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
                      {review.sourcePlatform === "reddit" ? "Reddit" : "Web User"}
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
        </>
      )}

      <LegalFooter />
    </main>
  );
}
