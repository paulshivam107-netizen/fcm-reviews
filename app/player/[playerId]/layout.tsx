import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";

type PlayerMetadataRow = {
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  mention_count: number | null;
  avg_sentiment_score: number | null;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function fetchPlayerMetadata(playerId: string): Promise<PlayerMetadataRow | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey || !isUuidLike(playerId)) return null;

  const summaryUrl = new URL(`${supabaseUrl}/rest/v1/mv_player_sentiment_summary`);
  summaryUrl.searchParams.set(
    "select",
    "player_name,base_ovr,base_position,program_promo,mention_count,avg_sentiment_score"
  );
  summaryUrl.searchParams.set("player_id", `eq.${playerId}`);
  summaryUrl.searchParams.set("limit", "1");

  try {
    const response = await fetch(summaryUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 600 },
    });

    if (!response.ok) return null;
    const rows = (await response.json()) as PlayerMetadataRow[];
    const first = rows[0];
    return first ?? null;
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

  const mentionCount = Number(player.mention_count ?? 0);
  const sentiment = Number(player.avg_sentiment_score ?? NaN);
  const sentimentText = Number.isFinite(sentiment) ? `${sentiment.toFixed(1)}/10` : "N/A";

  const title = `${player.player_name} ${player.base_ovr} ${player.base_position} Review`;
  const description =
    `${player.program_promo} card. Community sentiment ${sentimentText}` +
    ` from ${mentionCount} review${mentionCount === 1 ? "" : "s"}.`;

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
