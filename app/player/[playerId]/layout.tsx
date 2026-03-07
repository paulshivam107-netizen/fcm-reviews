import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";

type PlayerMetadataRow = {
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
};

type PlayerSummaryRow = {
  mention_count: number | null;
  avg_sentiment_score: number | null;
};

type PlayerMetadataResult = PlayerMetadataRow & {
  mention_count: number;
  avg_sentiment_score: number | null;
  hasApprovedReviews: boolean;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function fetchPlayerMetadata(playerId: string): Promise<PlayerMetadataResult | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey || !isUuidLike(playerId)) return null;

  const playerUrl = new URL(`${supabaseUrl}/rest/v1/players`);
  playerUrl.searchParams.set(
    "select",
    "player_name,base_ovr,base_position,program_promo"
  );
  playerUrl.searchParams.set("id", `eq.${playerId}`);
  playerUrl.searchParams.set("is_active", "eq.true");
  playerUrl.searchParams.set("limit", "1");

  try {
    const baseResponse = await fetch(playerUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 600 },
    });

    if (!baseResponse.ok) return null;
    const baseRows = (await baseResponse.json()) as PlayerMetadataRow[];
    const base = baseRows[0];
    if (!base) return null;

    const summaryUrl = new URL(`${supabaseUrl}/rest/v1/mv_player_sentiment_summary`);
    summaryUrl.searchParams.set("select", "mention_count,avg_sentiment_score");
    summaryUrl.searchParams.set("player_id", `eq.${playerId}`);
    summaryUrl.searchParams.set("limit", "1");

    const summaryResponse = await fetch(summaryUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 600 },
    });

    let mentionCount = 0;
    let avgSentiment: number | null = null;
    if (summaryResponse.ok) {
      const summaryRows = (await summaryResponse.json()) as PlayerSummaryRow[];
      const summary = summaryRows[0];
      mentionCount = Number(summary?.mention_count ?? 0);
      const rawAvg = summary?.avg_sentiment_score;
      avgSentiment =
        rawAvg === null || rawAvg === undefined ? null : Number(rawAvg);
    }

    if (mentionCount > 0 || avgSentiment !== null) {
      return {
        ...base,
        mention_count: mentionCount,
        avg_sentiment_score: avgSentiment,
        hasApprovedReviews: true,
      };
    }

    const approvedUrl = new URL(`${supabaseUrl}/rest/v1/user_review_submissions`);
    approvedUrl.searchParams.set("select", "id");
    approvedUrl.searchParams.set("player_id", `eq.${playerId}`);
    approvedUrl.searchParams.set("status", "eq.approved");
    approvedUrl.searchParams.set("limit", "1");

    const approvedResponse = await fetch(approvedUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 600 },
    });

    const hasApprovedReviews = approvedResponse.ok
      ? ((await approvedResponse.json()) as Array<{ id: string }>).length > 0
      : false;

    return {
      ...base,
      mention_count: mentionCount,
      avg_sentiment_score: avgSentiment,
      hasApprovedReviews,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>;
}): Promise<Metadata> {
  const { playerId } = await params;
  const siteUrl = getSiteUrl();
  const canonicalPath = `/player/${playerId}`;

  const player = await fetchPlayerMetadata(playerId);

  if (!player) {
    return {
      title: "Player Card",
      description: "FC Mobile player card sentiment and reviews.",
      robots: {
        index: false,
        follow: false,
      },
      alternates: {
        canonical: canonicalPath,
      },
      openGraph: {
        title: "FC Mobile Player Card",
        description: "FC Mobile player card sentiment and reviews.",
        url: `${siteUrl}${canonicalPath}`,
        type: "article",
      },
      twitter: {
        card: "summary",
        title: "FC Mobile Player Card",
        description: "FC Mobile player card sentiment and reviews.",
      },
    };
  }

  if (!player.hasApprovedReviews) {
    return {
      title: `${player.player_name} ${player.base_ovr} ${player.base_position}`,
      description: "No approved reviews published for this card yet.",
      robots: {
        index: false,
        follow: false,
      },
      alternates: {
        canonical: canonicalPath,
      },
    };
  }

  const mentionCount = Number(player.mention_count ?? 0);
  const sentiment = Number(player.avg_sentiment_score ?? NaN);
  const sentimentText = Number.isFinite(sentiment) ? `${sentiment.toFixed(1)}/10` : "N/A";

  const title = `${player.player_name} ${player.base_ovr} ${player.base_position} Review`;
  const description =
    `${player.program_promo} card. Community sentiment ${sentimentText}` +
    ` from ${mentionCount} approved review${mentionCount === 1 ? "" : "s"}.`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}${canonicalPath}`,
      type: "article",
      siteName: "FC Mobile Reviews",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
