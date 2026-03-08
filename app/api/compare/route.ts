import { NextRequest, NextResponse } from "next/server";
import { PlayerApiResponse } from "@/types/player";
import { CompareApiResponse, CompareCardPayload } from "@/types/compare";
import { PlayerReviewsApiResponse } from "@/types/review";

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function buildVerdict(card: CompareCardPayload["player"]) {
  const reviewCount = Math.max(0, Number(card.mention_count ?? 0));
  const pros = (card.top_pros ?? []).slice(0, 3).map((term) => term.text);
  const cons = (card.top_cons ?? []).slice(0, 2).map((term) => term.text);
  const sentiment = Number(card.avg_sentiment_score ?? NaN);
  const hasSentiment = Number.isFinite(sentiment);

  if (reviewCount === 0) {
    return "Not enough reviews yet for a full verdict.";
  }

  if (pros.length > 0 && cons.length > 0) {
    return `Community likes ${formatList(pros.slice(0, 2))}, but mentions ${formatList(
      cons.slice(0, 1)
    )}.`;
  }

  if (pros.length >= 2) {
    if (hasSentiment && sentiment >= 8.5) {
      return `Highly rated card with strong ${formatList(pros.slice(0, 3))}.`;
    }
    return `Early community feedback highlights ${formatList(pros.slice(0, 2))}.`;
  }

  if (pros.length === 1) {
    return `Early community feedback highlights ${pros[0]}.`;
  }

  if (cons.length > 0) {
    return `Community feedback is still limited, but ${formatList(
      cons.slice(0, 1)
    )} is mentioned as a weakness.`;
  }

  if (reviewCount <= 2) {
    return "Early community feedback is in, but more reviews will sharpen the verdict.";
  }

  return "Community feedback is building, but no clear consensus has formed yet.";
}

async function fetchCardBundle(request: NextRequest, playerId: string) {
  const playerUrl = new URL(`/api/player/${playerId}`, request.url);
  const reviewsUrl = new URL("/api/player-reviews", request.url);
  reviewsUrl.searchParams.set("playerId", playerId);
  reviewsUrl.searchParams.set("limit", "4");

  const [playerResponse, reviewsResponse] = await Promise.all([
    fetch(playerUrl, { cache: "no-store" }),
    fetch(reviewsUrl, { cache: "no-store" }),
  ]);

  if (!playerResponse.ok) {
    throw new Error(`Player request failed (${playerResponse.status})`);
  }
  if (!reviewsResponse.ok) {
    throw new Error(`Reviews request failed (${reviewsResponse.status})`);
  }

  const playerPayload = (await playerResponse.json()) as PlayerApiResponse;
  const reviewsPayload = (await reviewsResponse.json()) as PlayerReviewsApiResponse;
  const player = playerPayload.item;
  const reviewCount = Math.max(0, Number(player.mention_count ?? 0));

  const payload: CompareCardPayload = {
    player,
    reviews: reviewsPayload.items,
    verdict: buildVerdict(player),
    reviewCount,
    isEarlySignal: reviewCount > 0 && reviewCount < 3,
  };

  return payload;
}

export async function GET(request: NextRequest) {
  const leftId = String(request.nextUrl.searchParams.get("left") ?? "").trim();
  const rightId = String(request.nextUrl.searchParams.get("right") ?? "").trim();

  if (!isUuidLike(leftId)) {
    return NextResponse.json({ error: "Invalid left player id" }, { status: 400 });
  }

  if (rightId && !isUuidLike(rightId)) {
    return NextResponse.json({ error: "Invalid right player id" }, { status: 400 });
  }

  try {
    const [left, right] = await Promise.all([
      fetchCardBundle(request, leftId),
      rightId ? fetchCardBundle(request, rightId) : Promise.resolve(null),
    ]);

    const payload: CompareApiResponse = {
      left,
      right,
      meta: {
        leftId,
        rightId: rightId || null,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to build comparison",
      },
      { status: 500 }
    );
  }
}
