import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

type PlayerSitemapRow = {
  id: string;
  updated_at: string | null;
};

function toIsoDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

async function fetchActivePlayersForSitemap(): Promise<PlayerSitemapRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return [];

  const url = new URL(`${supabaseUrl}/rest/v1/players`);
  url.searchParams.set("select", "id,updated_at");
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("order", "updated_at.desc");
  url.searchParams.set("limit", "5000");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) return [];
    const rows = (await response.json()) as PlayerSitemapRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const now = new Date();
  const topTabEntries: MetadataRoute.Sitemap = [
    "attacker",
    "midfielder",
    "defender",
    "goalkeeper",
  ].map((tab) => ({
    url: `${siteUrl}/top/${tab}`,
    lastModified: now,
    changeFrequency: "hourly" as const,
    priority: 0.8,
  }));

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/feed.xml`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.4,
    },
    ...topTabEntries,
  ];

  const players = await fetchActivePlayersForSitemap();
  const playerEntries: MetadataRoute.Sitemap = players.map((row) => ({
    url: `${siteUrl}/player/${row.id}`,
    lastModified: toIsoDate(row.updated_at) ?? now,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  return [...staticEntries, ...playerEntries];
}
