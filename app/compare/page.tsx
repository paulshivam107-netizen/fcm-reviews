"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { LegalFooter } from "@/components/legal-footer";
import {
  buildPlaystyleComparisonRows,
  getPlaystyleComparisonWinner,
} from "@/lib/playstyle-insights";
import { POSITION_GROUPS } from "@/lib/position-groups";
import { CompareApiResponse, CompareCardPayload } from "@/types/compare";
import { PlayerRow, PlayerTab, PlayersApiResponse } from "@/types/player";
import { PlayerReviewFeedItem } from "@/types/review";

type FetchState = "idle" | "loading" | "success" | "error";
type Winner = "left" | "right" | "tie";

type VerdictItem = {
  label: string;
  winner: Winner;
  value: string;
  detail: string;
};

type SnapshotMetric = {
  label: string;
  leftValue: string;
  rightValue: string;
  winner: Winner;
};

type PlaystyleRow = {
  label: string;
  winner: Winner;
  value: string;
};

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

function formatShortDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function truncateSummary(value: string | null, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
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

function getTopTerm(card: CompareCardPayload | null, key: "top_pros" | "top_cons") {
  if (!card) return null;
  const list = card.player[key] ?? [];
  return list[0] ?? null;
}

function compareNullableNumbers(
  leftValue: number | null | undefined,
  rightValue: number | null | undefined,
  options?: { higherBetter?: boolean; epsilon?: number }
): Winner {
  const higherBetter = options?.higherBetter ?? true;
  const epsilon = options?.epsilon ?? 0;
  const left = Number(leftValue);
  const right = Number(rightValue);
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);

  if (!leftValid && !rightValid) return "tie";
  if (leftValid && !rightValid) return "left";
  if (!leftValid && rightValid) return "right";
  if (Math.abs(left - right) <= epsilon) return "tie";

  if (higherBetter) {
    return left > right ? "left" : "right";
  }

  return left < right ? "left" : "right";
}

function winnerName(winner: Winner, leftName: string, rightName: string, tieLabel = "Too close to call") {
  if (winner === "left") return leftName;
  if (winner === "right") return rightName;
  return tieLabel;
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

function getFreshnessTimestamp(card: CompareCardPayload | null) {
  const timestamp = card?.player.last_processed_at
    ? new Date(card.player.last_processed_at).getTime()
    : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getBestOverallWinner(left: CompareCardPayload, right: CompareCardPayload) {
  const ratingWinner = compareNullableNumbers(
    left.player.avg_sentiment_score,
    right.player.avg_sentiment_score,
    { epsilon: 0.15 }
  );
  if (ratingWinner !== "tie") return ratingWinner;

  const reviewWinner = compareNullableNumbers(left.reviewCount, right.reviewCount, {
    epsilon: 0,
  });
  if (reviewWinner !== "tie") return reviewWinner;

  return compareNullableNumbers(getFreshnessTimestamp(left), getFreshnessTimestamp(right), {
    epsilon: 0,
  });
}

function buildPlaystyleRows(left: CompareCardPayload, right: CompareCardPayload) {
  const rows = buildPlaystyleComparisonRows({
    leftPros: left.player.top_pros,
    leftCons: left.player.top_cons,
    rightPros: right.player.top_pros,
    rightCons: right.player.top_cons,
  }).map((row) => {
    const winner = getPlaystyleComparisonWinner(row);
    return {
      label: row.label,
      winner,
      value: winnerName(
        winner,
        left.player.player_name,
        right.player.player_name,
        "Even signal"
      ),
    } satisfies PlaystyleRow;
  });

  return rows
    .slice(0, 5);
}

function winnerAccentClasses(side: "left" | "right", winner: Winner) {
  if (winner === side) {
    return "border-lime-300/35 bg-lime-300/12 text-lime-100 shadow-[0_0_0_1px_rgba(190,242,100,0.12),0_0_28px_rgba(132,204,22,0.14)]";
  }

  if (winner === "tie") {
    return "border-white/10 bg-white/5 text-slate-100";
  }

  return "border-white/10 bg-white/5 text-slate-300";
}

function SnapshotValue({
  value,
  side,
  winner,
}: {
  value: string;
  side: "left" | "right";
  winner: Winner;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${winnerAccentClasses(
        side,
        winner
      )}`}
    >
      {value}
    </div>
  );
}

function ComparisonRow({
  label,
  left,
  right,
  winner,
}: {
  label: string;
  left: string;
  right: string;
  winner: Winner;
}) {
  return (
    <div className="grid min-w-[620px] grid-cols-[148px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <SnapshotValue value={left} side="left" winner={winner} />
      <SnapshotValue value={right} side="right" winner={winner} />
    </div>
  );
}

function SelectedCardChip({
  label,
  player,
  isPlaceholder = false,
  onClear,
}: {
  label: string;
  player: PlayerRow | null;
  isPlaceholder?: boolean;
  onClear?: () => void;
}) {
  if (!player) {
    return (
      <div className="rounded-full border border-dashed border-white/20 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400">
        {label}: {isPlaceholder ? "Select second card" : "Not selected"}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-lime-300/25 bg-lime-300/10 px-4 py-2 text-xs font-medium text-slate-100">
      <span className="text-lime-200">{label}</span>
      <span>
        {player.player_name} · {player.base_ovr} · {player.base_position}
      </span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-300 transition hover:bg-white/10"
        >
          Clear
        </button>
      )}
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
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {label}
          </p>
          <h2 className="mt-2 truncate text-lg font-semibold text-slate-100">
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

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Rating
          </p>
          <p className="mt-1 text-sm font-semibold text-lime-200">
            {formatSentiment(card.player.avg_sentiment_score)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Reviews
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {card.reviewCount}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Updated
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {formatShortDate(card.player.last_processed_at)}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-lime-300/15 bg-lime-300/6 px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          Community Verdict
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-200">{card.verdict}</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Link
          href={`/player/${card.player.player_id}`}
          className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
        >
          View Card Page
        </Link>
        <Link
          href={buildAddReviewHref(card.player)}
          className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
        >
          Add Review
        </Link>
        <Link
          href={`/compare?left=${card.player.player_id}`}
          className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
        >
          Compare Another
        </Link>
      </div>
    </section>
  );
}

function VerdictPanel({
  items,
}: {
  items: VerdictItem[];
}) {
  return (
    <section className="glass-panel rounded-2xl p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
          Comparison Verdict
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Fast read on which card looks stronger overall and where each card has the edge.
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className={`rounded-xl border px-4 py-4 ${
              item.winner === "tie"
                ? "border-white/10 bg-white/5"
                : "border-lime-300/18 bg-lime-300/8"
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-2 text-base font-semibold text-slate-100">{item.value}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewPeekPanel({
  title,
  card,
}: {
  title: string;
  card: CompareCardPayload;
}) {
  const [latest, ...rest] = card.reviews;

  return (
    <section className="glass-panel rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {card.player.player_name} · {formatReviewCount(card.reviewCount)}
          </p>
        </div>
        <Link
          href={`/player/${card.player.player_id}`}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-200 transition hover:bg-white/10"
        >
          View all reviews
        </Link>
      </div>

      {!latest && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
          No approved reviews available yet.
        </div>
      )}

      {latest && (
        <article className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">
                {buildReviewDisplayName(latest)}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {buildReviewSourceLabel(latest)} · {formatWhen(latest.submittedAt)}
                {latest.playedPosition ? ` · ${latest.playedPosition}` : ""}
              </p>
            </div>
            <p className="text-xs font-semibold text-lime-200">
              {formatSentiment(latest.sentimentScore)}
            </p>
          </div>

          {latest.summary && (
            <p className="mt-3 text-sm leading-relaxed text-slate-200">
              {truncateSummary(latest.summary, 220)}
            </p>
          )}

          {latest.pros.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {latest.pros.slice(0, 3).map((pro) => (
                <span
                  key={`${latest.id}-${pro}`}
                  className="rounded-full border border-lime-300/25 bg-lime-300/10 px-2.5 py-1 text-[11px] font-medium text-lime-100"
                >
                  {pro}
                </span>
              ))}
            </div>
          )}
        </article>
      )}

      {rest.length > 0 && (
        <details className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-slate-200 marker:hidden">
            Show {rest.length} more {rest.length === 1 ? "review" : "reviews"}
          </summary>
          <div className="mt-3 space-y-3">
            {rest.map((review) => (
              <article key={`${title}-${review.id}`} className="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {buildReviewDisplayName(review)}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      {buildReviewSourceLabel(review)} · {formatWhen(review.submittedAt)}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-lime-200">
                    {formatSentiment(review.sentimentScore)}
                  </p>
                </div>
                {review.summary && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-200">
                    {truncateSummary(review.summary, 160)}
                  </p>
                )}
              </article>
            ))}
          </div>
        </details>
      )}
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
  const rightPlayer = compareData?.right?.player ?? null;
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
          limit: "6",
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

  const comparisonVerdict = useMemo(() => {
    if (!compareData?.right) return [];
    const left = compareData.left;
    const right = compareData.right;

    const bestOverallWinner = getBestOverallWinner(left, right);
    const dribblingWinner =
      buildPlaystyleRows(left, right).find((row) => row.label === "Dribbling")?.winner ??
      "tie";
    const finishingWinner =
      buildPlaystyleRows(left, right).find((row) => row.label === "Finishing")?.winner ??
      "tie";
    const confidenceWinner = compareNullableNumbers(left.reviewCount, right.reviewCount);
    const freshnessWinner = compareNullableNumbers(
      getFreshnessTimestamp(left),
      getFreshnessTimestamp(right)
    );

    return [
      {
        label: "Best Overall",
        winner: bestOverallWinner,
        value: winnerName(
          bestOverallWinner,
          left.player.player_name,
          right.player.player_name
        ),
        detail:
          bestOverallWinner === "tie"
            ? "Community rating and confidence are too close to separate cleanly."
            : "Weighted by community rating first, then review confidence and freshness.",
      },
      {
        label: "Better Dribbling",
        winner: dribblingWinner,
        value: winnerName(dribblingWinner, left.player.player_name, right.player.player_name, "Even signal"),
        detail: `Based on tags like ${formatList(["dribbling", "skill moves", "agility"])}.`,
      },
      {
        label: "Better Finishing",
        winner: finishingWinner,
        value: winnerName(finishingWinner, left.player.player_name, right.player.player_name, "Even signal"),
        detail: `Derived from tags like ${formatList(["finishing", "finesse", "long shots"])}.`,
      },
      {
        label: "More Community Confidence",
        winner: confidenceWinner,
        value: winnerName(
          confidenceWinner,
          left.player.player_name,
          right.player.player_name,
          "Same review volume"
        ),
        detail: "Uses approved review count as the confidence signal behind the score.",
      },
      {
        label: "Fresher Review Signal",
        winner: freshnessWinner,
        value: winnerName(
          freshnessWinner,
          left.player.player_name,
          right.player.player_name,
          "Same freshness"
        ),
        detail: "Uses the most recent update/review timestamp for each card.",
      },
    ] satisfies VerdictItem[];
  }, [compareData]);

  const snapshotRows = useMemo(() => {
    if (!compareData?.right) return [];
    const left = compareData.left;
    const right = compareData.right;
    const leftTopStrength = getTopTerm(left, "top_pros");
    const rightTopStrength = getTopTerm(right, "top_pros");
    const leftTopWeakness = getTopTerm(left, "top_cons");
    const rightTopWeakness = getTopTerm(right, "top_cons");

    return [
      {
        label: "Community Rating",
        leftValue: formatSentiment(left.player.avg_sentiment_score),
        rightValue: formatSentiment(right.player.avg_sentiment_score),
        winner: compareNullableNumbers(
          left.player.avg_sentiment_score,
          right.player.avg_sentiment_score,
          { epsilon: 0.15 }
        ),
      },
      {
        label: "Review Count",
        leftValue: formatReviewCount(left.reviewCount),
        rightValue: formatReviewCount(right.reviewCount),
        winner: compareNullableNumbers(left.reviewCount, right.reviewCount),
      },
      {
        label: "Last Updated",
        leftValue: formatShortDate(left.player.last_processed_at),
        rightValue: formatShortDate(right.player.last_processed_at),
        winner: compareNullableNumbers(
          getFreshnessTimestamp(left),
          getFreshnessTimestamp(right)
        ),
      },
      {
        label: "Top Strength",
        leftValue: leftTopStrength
          ? `${leftTopStrength.text} (${leftTopStrength.count})`
          : "No clear strength yet",
        rightValue: rightTopStrength
          ? `${rightTopStrength.text} (${rightTopStrength.count})`
          : "No clear strength yet",
        winner: compareNullableNumbers(leftTopStrength?.count, rightTopStrength?.count),
      },
      {
        label: "Top Weakness",
        leftValue: leftTopWeakness
          ? `${leftTopWeakness.text} (${leftTopWeakness.count})`
          : "No major weakness",
        rightValue: rightTopWeakness
          ? `${rightTopWeakness.text} (${rightTopWeakness.count})`
          : "No major weakness",
        winner: compareNullableNumbers(
          leftTopWeakness?.count ?? 0,
          rightTopWeakness?.count ?? 0,
          { higherBetter: false, epsilon: 0 }
        ),
      },
    ] satisfies SnapshotMetric[];
  }, [compareData]);

  const playstyleRows = useMemo(() => {
    if (!compareData?.right) return [];
    return buildPlaystyleRows(compareData.left, compareData.right);
  }, [compareData]);

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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                  Pick the two cards you want to compare
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Card A stays locked. Search for Card B by player name and OVR, then swap it any time.
                </p>
              </div>
              {compareData.right && (
                <button
                  type="button"
                  onClick={clearRightCard}
                  className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
                >
                  Reset Card B
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SelectedCardChip label="Card A" player={leftPlayer} />
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                vs
              </span>
              <SelectedCardChip
                label="Card B"
                player={rightPlayer}
                isPlaceholder
                onClear={rightPlayer ? clearRightCard : undefined}
              />
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
                  <div className="text-right">
                    <p className="text-xs font-semibold text-lime-200">
                      {formatSentiment(row.avg_sentiment_score)}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                      Compare
                    </p>
                  </div>
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
              <section className="mt-5">
                <VerdictPanel items={comparisonVerdict} />
              </section>

              <section className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="glass-panel rounded-2xl p-4">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                      Side-by-Side Snapshot
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Compact view of the signals that matter most for a quick decision.
                    </p>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <div className="space-y-2">
                      {snapshotRows.map((row) => (
                        <ComparisonRow
                          key={row.label}
                          label={row.label}
                          left={row.leftValue}
                          right={row.rightValue}
                          winner={row.winner}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                <section className="glass-panel rounded-2xl p-4">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">
                      Playstyle Comparison
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Uses recurring pros and cons to estimate which card fits a given style better.
                    </p>
                  </div>

                  <div className="mt-4 space-y-2">
                    {playstyleRows.length === 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-300">
                        Not enough tagged review data yet to compare playstyle fit.
                      </div>
                    )}

                    {playstyleRows.map((row) => (
                      <div
                        key={row.label}
                        className={`rounded-xl border px-3 py-3 ${
                          row.winner === "tie"
                            ? "border-white/10 bg-white/5"
                            : "border-lime-300/18 bg-lime-300/8"
                        }`}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Better for {row.label}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">{row.value}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </section>

              <section className="mt-5 grid gap-4 lg:grid-cols-2">
                <ReviewPeekPanel title="Recent Review Signal: Card A" card={compareData.left} />
                <ReviewPeekPanel title="Recent Review Signal: Card B" card={compareData.right} />
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
