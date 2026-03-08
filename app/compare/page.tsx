"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { LegalFooter } from "@/components/legal-footer";
import { POSITION_GROUPS } from "@/lib/position-groups";
import { CompareApiResponse, CompareCardPayload } from "@/types/compare";
import { PlayerRow, PlayerTab, PlayersApiResponse } from "@/types/player";
import { PlayerReviewFeedItem } from "@/types/review";

type FetchState = "idle" | "loading" | "success" | "error";

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

function buildReviewSourceLabel(review: PlayerReviewFeedItem) {
  return review.sourcePlatform === "reddit" ? "Reddit-sourced" : "Web submission";
}

function buildReviewDisplayName(review: PlayerReviewFeedItem) {
  const label = review.sourceLabel.trim();
  if (review.sourcePlatform === "user" && label.toLowerCase() === "web user") {
    return "Community member";
  }
  return label || (review.sourcePlatform === "reddit" ? "Reddit source" : "Community member");
}

function getStrengthSummary(card: CompareCardPayload | null) {
  if (!card) return "No signal yet";
  const top = (card.player.top_pros ?? []).slice(0, 2).map((term) => term.text);
  return top.length > 0 ? formatList(top) : "No clear pattern yet";
}

function getWeaknessSummary(card: CompareCardPayload | null) {
  if (!card) return "No signal yet";
  const top = (card.player.top_cons ?? []).slice(0, 2).map((term) => term.text);
  return top.length > 0 ? formatList(top) : "No major weaknesses highlighted";
}

function ComparisonRow({
  label,
  left,
  right,
}: {
  label: string;
  left: string;
  right: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <p className="text-sm font-medium text-slate-100">{left}</p>
        <p className="text-sm font-medium text-slate-100">{right}</p>
      </div>
    </div>
  );
}

function CompareCard({
  label,
  card,
}: {
  label: string;
  card: CompareCardPayload | null;
}) {
  if (!card) {
    return (
      <section className="glass-panel rounded-2xl p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          {label}
        </p>
        <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-slate-100">Pick another card to compare</p>
          <p className="mt-1 text-xs text-slate-400">
            Search by player name and OVR to load a second card.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="glass-panel rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {label}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">
            {card.player.player_name}
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            OVR {card.player.base_ovr} · {card.player.base_position}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
            {card.player.program_promo}
          </span>
          {card.isEarlySignal && (
            <span className="rounded-full border border-amber-300/35 bg-amber-300/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
              Early signal
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Community Rating
        </p>
        <p className="mt-1 text-sm font-semibold text-lime-200">
          {formatCommunityRating(card.player.avg_sentiment_score, card.reviewCount)}
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-lime-300/15 bg-lime-300/6 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          Community Verdict
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-200">{card.verdict}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href={buildAddReviewHref(card.player)}
          className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
        >
          Add Your Review
        </Link>
        <Link
          href={`/player/${card.player.player_id}`}
          className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
        >
          View Card
        </Link>
      </div>
    </section>
  );
}

function ReviewColumn({
  title,
  card,
}: {
  title: string;
  card: CompareCardPayload;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
          {title}
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {card.player.player_name} · {formatReviewCount(card.reviewCount)}
        </p>
      </div>

      {card.reviews.length === 0 && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          No approved reviews available yet.
        </div>
      )}

      {card.reviews.map((review) => (
        <article
          key={`${title}-${review.id}`}
          className="glass-panel rounded-2xl border border-white/10 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">
                {buildReviewDisplayName(review)}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {buildReviewSourceLabel(review)} · {formatWhen(review.submittedAt)}
                {review.playedPosition ? ` · ${review.playedPosition}` : ""}
              </p>
            </div>
            <p className="text-xs font-semibold text-lime-200">
              {formatSentiment(review.sentimentScore)}
            </p>
          </div>
          {review.summary && (
            <p className="mt-3 text-sm leading-relaxed text-slate-200">{review.summary}</p>
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
  );
}

function ComparePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leftId = String(searchParams.get("left") ?? "").trim();
  const rightId = String(searchParams.get("right") ?? "").trim();
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [compareData, setCompareData] = useState<CompareApiResponse | null>(null);
  const [candidateDraft, setCandidateDraft] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateState, setCandidateState] = useState<FetchState>("idle");
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PlayerRow[]>([]);

  const validLeft = isUuidLike(leftId);
  const validRight = !rightId || isUuidLike(rightId);
  const leftPlayer = compareData?.left.player ?? null;
  const candidateTab = useMemo(
    () => getPlayerTabForPosition(leftPlayer?.base_position ?? "ST"),
    [leftPlayer?.base_position]
  );

  useEffect(() => {
    if (!validLeft || !validRight) {
      setState("error");
      setError("Invalid compare URL.");
      setCompareData(null);
      return;
    }

    let cancelled = false;

    async function loadCompare() {
      setState("loading");
      setError(null);

      try {
        const params = new URLSearchParams({ left: leftId });
        if (rightId) params.set("right", rightId);
        const response = await fetch(`/api/compare?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Compare request failed (${response.status})`);
        }

        const payload = (await response.json()) as CompareApiResponse;
        if (!cancelled) {
          setCompareData(payload);
          setState("success");
        }
      } catch (loadError) {
        if (cancelled) return;
        setCompareData(null);
        setState("error");
        setError(
          loadError instanceof Error ? loadError.message : "Unknown compare error"
        );
      }
    }

    void loadCompare();
    return () => {
      cancelled = true;
    };
  }, [leftId, rightId, validLeft, validRight]);

  useEffect(() => {
    if (!leftPlayer) {
      setCandidates([]);
      setCandidateState("idle");
      setCandidateError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadCandidates() {
      setCandidateState("loading");
      setCandidateError(null);

      try {
        const params = new URLSearchParams({
          tab: candidateTab,
          limit: "8",
        });
        if (candidateQuery.trim()) {
          params.set("q", candidateQuery.trim());
        }
        const response = await fetch(`/api/players?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Candidate request failed (${response.status})`);
        }

        const payload = (await response.json()) as PlayersApiResponse;
        const rows = payload.items.filter(
          (row) => row.player_id !== leftId && row.player_id !== rightId
        );

        if (!cancelled) {
          setCandidates(rows);
          setCandidateState("success");
        }
      } catch (loadError) {
        if (cancelled) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setCandidates([]);
        setCandidateState("error");
        setCandidateError(
          loadError instanceof Error ? loadError.message : "Unknown candidate error"
        );
      }
    }

    void loadCandidates();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [candidateQuery, candidateTab, leftId, leftPlayer, rightId]);

  const onSubmitCandidateSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCandidateQuery(candidateDraft.trim());
  };

  const selectRightCard = (playerId: string) => {
    const params = new URLSearchParams({ left: leftId, right: playerId });
    router.replace(`/compare?${params.toString()}`, { scroll: false });
  };

  const clearRightCard = () => {
    const params = new URLSearchParams({ left: leftId });
    router.replace(`/compare?${params.toString()}`, { scroll: false });
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-lg px-4 pb-12 pt-7 sm:px-6">
      <header className="mb-5">
        <Link
          href={leftPlayer ? `/player/${leftPlayer.player_id}` : "/"}
          className="mb-3 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
        >
          Back
        </Link>
        <p className="text-xs uppercase tracking-[0.14em] text-lime-200">Compare Cards</p>
        <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">
          FC Mobile Card Comparison
        </h1>
        <p className="mt-2 max-w-[60ch] text-sm text-slate-300">
          Compare two player cards side by side using community ratings, review counts,
          verdicts, strengths, weaknesses, and recent feedback.
        </p>
      </header>

      {!validLeft && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-rose-200">
          Invalid comparison link. Open a player card first, then compare from there.
        </div>
      )}

      {state === "loading" && (
        <div className="space-y-3">
          <div className="glass-panel h-32 animate-pulse rounded-2xl border border-white/10" />
          <div className="glass-panel h-28 animate-pulse rounded-2xl border border-white/10" />
          <div className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10" />
        </div>
      )}

      {state === "error" && validLeft && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-rose-200">
          Failed to load comparison: {error ?? "Unknown error"}
        </div>
      )}

      {state === "success" && compareData && (
        <>
          <section className="glass-panel rounded-2xl p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                  Compare With Another Card
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Search by player name and OVR. Results are biased toward the same role to keep comparisons relevant.
                </p>
              </div>
              {compareData.right && (
                <button
                  type="button"
                  onClick={clearRightCard}
                  className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
                >
                  Clear Comparison
                </button>
              )}
            </div>

            <form onSubmit={onSubmitCandidateSearch} className="mt-4 flex gap-2">
              <input
                type="search"
                value={candidateDraft}
                onChange={(event) => setCandidateDraft(event.target.value)}
                placeholder='Try "117 Messi" or "Gullit 117"'
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-lime-300/40 focus:bg-white/8"
              />
              <button
                type="submit"
                className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
              >
                Search
              </button>
            </form>

            <div className="mt-4 space-y-2">
              {candidateState === "loading" && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={`candidate-loading-${index}`}
                      className="h-14 animate-pulse rounded-xl border border-white/10 bg-white/5"
                    />
                  ))}
                </div>
              )}

              {candidateState === "error" && (
                <div className="rounded-xl border border-rose-300/25 bg-rose-300/10 px-3 py-3 text-sm text-rose-100">
                  Failed to load candidates: {candidateError ?? "Unknown error"}
                </div>
              )}

              {candidateState === "success" && candidates.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
                  No matching cards found. Try a broader player name or exact OVR.
                </div>
              )}

              {candidates.map((row) => (
                <button
                  key={`candidate-${row.player_id}`}
                  type="button"
                  onClick={() => selectRightCard(row.player_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:border-lime-300/35 hover:bg-white/8"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {row.player_name}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      OVR {row.base_ovr} · {row.base_position} · {row.program_promo}
                    </p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-[0.1em] text-lime-200">
                    Compare
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-5 grid gap-4 lg:grid-cols-2">
            <CompareCard label="Card A" card={compareData.left} />
            <CompareCard label="Card B" card={compareData.right} />
          </section>

          {compareData.right && (
            <>
              <section className="mt-5 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
                    Side-by-Side Snapshot
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Compare community signal, freshness, and recurring strengths or weaknesses.
                  </p>
                </div>

                <div className="space-y-2">
                  <ComparisonRow
                    label="Community Rating"
                    left={formatCommunityRating(
                      compareData.left.player.avg_sentiment_score,
                      compareData.left.reviewCount
                    )}
                    right={formatCommunityRating(
                      compareData.right.player.avg_sentiment_score,
                      compareData.right.reviewCount
                    )}
                  />
                  <ComparisonRow
                    label="Last Updated"
                    left={formatWhen(compareData.left.player.last_processed_at)}
                    right={formatWhen(compareData.right.player.last_processed_at)}
                  />
                  <ComparisonRow
                    label="Most Mentioned Strengths"
                    left={getStrengthSummary(compareData.left)}
                    right={getStrengthSummary(compareData.right)}
                  />
                  <ComparisonRow
                    label="Most Mentioned Weaknesses"
                    left={getWeaknessSummary(compareData.left)}
                    right={getWeaknessSummary(compareData.right)}
                  />
                </div>
              </section>

              <section className="mt-5 grid gap-4 lg:grid-cols-2">
                <ReviewColumn title="Recent Reviews: Card A" card={compareData.left} />
                <ReviewColumn title="Recent Reviews: Card B" card={compareData.right} />
              </section>
            </>
          )}
        </>
      )}

      <LegalFooter />
    </main>
  );
}

function ComparePageFallback() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-lg px-4 pb-12 pt-7 sm:px-6">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-[0.14em] text-lime-200">Compare Cards</p>
        <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">
          FC Mobile Card Comparison
        </h1>
      </header>
      <div className="space-y-3">
        <div className="glass-panel h-32 animate-pulse rounded-2xl border border-white/10" />
        <div className="glass-panel h-28 animate-pulse rounded-2xl border border-white/10" />
        <div className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10" />
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<ComparePageFallback />}>
      <ComparePageClient />
    </Suspense>
  );
}
