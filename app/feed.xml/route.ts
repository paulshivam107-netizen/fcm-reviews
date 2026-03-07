import { NextResponse } from "next/server";
import {
  LOCAL_MOCK_PLAYERS,
  LOCAL_MOCK_REVIEW_SEEDS,
  shouldUseLocalMockData,
} from "@/lib/local-mock-data";
import { getSiteUrl } from "@/lib/site-url";

type ApprovedReviewRow = {
  id: string;
  player_id: string;
  sentiment_score: number | string;
  note: string | null;
  submitted_at: string;
};

type PlayerRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
};

const FEED_LIMIT = 120;

function escapeXml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIso(value: string | null | undefined) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function buildRssXml(items: Array<{
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
}>): string {
  const siteUrl = getSiteUrl();
  const updatedAt = items[0]?.pubDate ?? new Date().toISOString();
  const itemXml = items
    .map(
      (item) => `<item>
<guid isPermaLink="false">${escapeXml(item.id)}</guid>
<title>${escapeXml(item.title)}</title>
<link>${escapeXml(item.link)}</link>
<description>${escapeXml(item.description)}</description>
<pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
</item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>FC Mobile Reviews - Latest Approved Reviews</title>
<link>${escapeXml(siteUrl)}</link>
<description>Latest approved FC Mobile player reviews and sentiment updates.</description>
<language>en-US</language>
<lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>
${itemXml}
</channel>
</rss>`;
}

export async function GET() {
  const siteUrl = getSiteUrl();
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const headers = {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "s-maxage=900, stale-while-revalidate=86400",
  };

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey) || !supabaseUrl || !supabaseKey) {
    const playerMap = new Map(LOCAL_MOCK_PLAYERS.map((player) => [player.player_id, player]));
    const items = LOCAL_MOCK_REVIEW_SEEDS.filter((seed) => seed.status === "approved")
      .sort(
        (a, b) =>
          new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
      )
      .slice(0, FEED_LIMIT)
      .map((seed) => {
        const player = playerMap.get(seed.player_id);
        const score = Number(seed.sentiment_score);
        const sentiment = Number.isFinite(score) ? `${score.toFixed(1)}/10` : "N/A";
        const playerLabel = player
          ? `${player.player_name} ${player.base_ovr} ${player.base_position}`
          : "FC Mobile card";
        return {
          id: seed.id,
          title: `${playerLabel} review (${sentiment})`,
          link: `${siteUrl}/player/${seed.player_id}`,
          description:
            seed.note?.trim().slice(0, 400) ??
            "Approved community review available on FC Mobile Reviews.",
          pubDate: toIso(seed.submitted_at),
        };
      });

    return new NextResponse(buildRssXml(items), { headers });
  }

  try {
    const reviewsUrl = new URL(`${supabaseUrl}/rest/v1/user_review_submissions`);
    reviewsUrl.searchParams.set(
      "select",
      "id,player_id,sentiment_score,note,submitted_at"
    );
    reviewsUrl.searchParams.set("status", "eq.approved");
    reviewsUrl.searchParams.set("order", "submitted_at.desc");
    reviewsUrl.searchParams.set("limit", String(FEED_LIMIT));

    const reviewsResponse = await fetch(reviewsUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 900 },
    });

    if (!reviewsResponse.ok) {
      return new NextResponse(buildRssXml([]), { headers });
    }

    const reviews = (await reviewsResponse.json()) as ApprovedReviewRow[];
    const playerIds = Array.from(new Set(reviews.map((review) => review.player_id))).slice(
      0,
      FEED_LIMIT
    );

    const playerMap = new Map<string, PlayerRow>();
    if (playerIds.length > 0) {
      const playersUrl = new URL(`${supabaseUrl}/rest/v1/players`);
      playersUrl.searchParams.set(
        "select",
        "id,player_name,base_ovr,base_position,program_promo"
      );
      playersUrl.searchParams.set("id", `in.(${playerIds.join(",")})`);
      playersUrl.searchParams.set("is_active", "eq.true");
      playersUrl.searchParams.set("limit", String(playerIds.length));

      const playersResponse = await fetch(playersUrl.toString(), {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        next: { revalidate: 900 },
      });

      if (playersResponse.ok) {
        const players = (await playersResponse.json()) as PlayerRow[];
        for (const player of players) {
          playerMap.set(player.id, player);
        }
      }
    }

    const items = reviews.map((review) => {
      const player = playerMap.get(review.player_id);
      const score = Number(review.sentiment_score);
      const sentiment = Number.isFinite(score) ? `${score.toFixed(1)}/10` : "N/A";
      const playerLabel = player
        ? `${player.player_name} ${player.base_ovr} ${player.base_position}`
        : "FC Mobile card";

      return {
        id: review.id,
        title: `${playerLabel} review (${sentiment})`,
        link: `${siteUrl}/player/${review.player_id}`,
        description:
          review.note?.trim().slice(0, 400) ??
          "Approved community review available on FC Mobile Reviews.",
        pubDate: toIso(review.submitted_at),
      };
    });

    return new NextResponse(buildRssXml(items), { headers });
  } catch {
    return new NextResponse(buildRssXml([]), { headers });
  }
}
