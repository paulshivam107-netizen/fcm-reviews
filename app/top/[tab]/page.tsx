import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalFooter } from "@/components/legal-footer";
import { LOCAL_MOCK_PLAYERS, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { POSITION_GROUPS, TAB_LABELS } from "@/lib/position-groups";
import { getSiteUrl } from "@/lib/site-url";
import { PlayerInsightTerm, PlayerRow, PlayerTab } from "@/types/player";

type TopPageParams = {
  tab: string;
};

type TopSummaryRow = {
  player_id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  mention_count: number | null;
  avg_sentiment_score: number | null;
  top_pros: PlayerInsightTerm[] | null;
  top_cons: PlayerInsightTerm[] | null;
  last_processed_at: string | null;
};

const TOP_TABS: PlayerTab[] = [
  "attacker",
  "midfielder",
  "defender",
  "goalkeeper",
];
const TOP_PAGE_LIMIT = 30;

function parseTopTab(input: string): PlayerTab | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "attacker") return "attacker";
  if (normalized === "midfielder") return "midfielder";
  if (normalized === "defender") return "defender";
  if (normalized === "goalkeeper") return "goalkeeper";
  return null;
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

function normalizeInsightTerms(terms: PlayerInsightTerm[] | null | undefined) {
  if (!Array.isArray(terms)) return [];
  return terms.filter(
    (term) =>
      term &&
      typeof term.text === "string" &&
      term.text.trim().length > 0 &&
      Number.isFinite(term.count)
  );
}

function sortRows(a: PlayerRow, b: PlayerRow) {
  const scoreA = a.avg_sentiment_score ?? -1;
  const scoreB = b.avg_sentiment_score ?? -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  if (a.mention_count !== b.mention_count) return b.mention_count - a.mention_count;
  if (a.base_ovr !== b.base_ovr) return b.base_ovr - a.base_ovr;
  return a.player_name.localeCompare(b.player_name);
}

async function fetchTopRows(tab: PlayerTab): Promise<PlayerRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const basePositions = POSITION_GROUPS[tab];

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey) || !supabaseUrl || !supabaseKey) {
    return LOCAL_MOCK_PLAYERS.filter(
      (row) => basePositions.includes(row.base_position) && row.mention_count > 0
    )
      .sort(sortRows)
      .slice(0, TOP_PAGE_LIMIT);
  }

  const url = new URL(`${supabaseUrl}/rest/v1/mv_player_sentiment_summary`);
  url.searchParams.set(
    "select",
    "player_id,player_name,base_ovr,base_position,program_promo,mention_count,avg_sentiment_score,top_pros,top_cons,last_processed_at"
  );
  url.searchParams.set("base_position", `in.(${basePositions.join(",")})`);
  url.searchParams.set("mention_count", "gt.0");
  url.searchParams.set(
    "order",
    "avg_sentiment_score.desc.nullslast,mention_count.desc,base_ovr.desc,player_name.asc"
  );
  url.searchParams.set("limit", String(TOP_PAGE_LIMIT));

  try {
    const response = await fetch(url.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) return [];
    const rows = (await response.json()) as TopSummaryRow[];

    return rows.map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      base_ovr: Number(row.base_ovr),
      base_position: row.base_position,
      program_promo: row.program_promo,
      mention_count: Number(row.mention_count ?? 0),
      avg_sentiment_score:
        row.avg_sentiment_score === null ? null : Number(row.avg_sentiment_score),
      top_pros: normalizeInsightTerms(row.top_pros),
      top_cons: normalizeInsightTerms(row.top_cons),
      last_processed_at: row.last_processed_at,
    }));
  } catch {
    return [];
  }
}

export async function generateStaticParams() {
  return TOP_TABS.map((tab) => ({ tab }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<TopPageParams>;
}) {
  const { tab: rawTab } = await params;
  const tab = parseTopTab(rawTab);
  if (!tab) {
    return {
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const title = `Top ${TAB_LABELS[tab]} Cards by Community Sentiment`;
  const description =
    `Track the highest-rated ${TAB_LABELS[tab].toLowerCase()} cards in FC Mobile ` +
    "using approved community reviews.";
  return {
    title,
    description,
    alternates: {
      canonical: `/top/${tab}`,
    },
    openGraph: {
      title,
      description,
      url: `/top/${tab}`,
      type: "website",
      siteName: "FC Mobile Reviews",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function TopPositionPage({
  params,
}: {
  params: Promise<TopPageParams>;
}) {
  const { tab: rawTab } = await params;
  const tab = parseTopTab(rawTab);
  if (!tab) {
    notFound();
  }

  const rows = await fetchTopRows(tab);
  const siteUrl = getSiteUrl();
  const lastUpdated = rows[0]?.last_processed_at ?? null;

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Top ${TAB_LABELS[tab]} Cards`,
    itemListOrder: "Descending",
    numberOfItems: rows.length,
    itemListElement: rows.map((row, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${siteUrl}/player/${row.player_id}`,
      name: `${row.player_name} ${row.base_ovr} ${row.base_position}`,
    })),
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <header className="mb-6">
        <Link
          href="/"
          className="mb-3 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
        >
          Back
        </Link>
        <p className="mb-2 inline-flex items-center rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          Top Players
        </p>
        <h1 className="text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">
          Top {TAB_LABELS[tab]} Cards
        </h1>
        <p className="mt-2 max-w-[42ch] text-sm text-slate-300">
          Rankings are based on approved review sentiment first, then mention volume,
          then OVR. Last update: {formatWhen(lastUpdated)}.
        </p>
      </header>

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Top position pages">
        {TOP_TABS.map((candidate) => (
          <Link
            key={candidate}
            href={`/top/${candidate}`}
            className={[
              "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition",
              candidate === tab
                ? "tab-active-glow text-slate-950"
                : "border border-white/15 bg-white/5 text-slate-300 hover:bg-white/10",
            ].join(" ")}
          >
            {TAB_LABELS[candidate]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 && (
        <section className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          No approved review data is available for this position yet.
        </section>
      )}

      {rows.length > 0 && (
        <section className="space-y-3">
          {rows.map((row, index) => {
            const topPros = normalizeInsightTerms(row.top_pros).slice(0, 2);
            const topCons = normalizeInsightTerms(row.top_cons).slice(0, 1);
            return (
              <article key={row.player_id} className="glass-panel rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Rank #{index + 1}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-slate-100">
                      {row.player_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-300">
                      OVR {row.base_ovr} · {row.base_position} · {row.program_promo}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-lime-200">
                      {formatSentiment(row.avg_sentiment_score)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {row.mention_count} mentions
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {topPros.map((term) => (
                    <span
                      key={`pro-${row.player_id}-${term.text}`}
                      className="rounded-full border border-lime-300/30 bg-lime-300/10 px-2.5 py-1 text-[11px] text-lime-100"
                    >
                      + {term.text}
                    </span>
                  ))}
                  {topCons.map((term) => (
                    <span
                      key={`con-${row.player_id}-${term.text}`}
                      className="rounded-full border border-rose-300/30 bg-rose-300/10 px-2.5 py-1 text-[11px] text-rose-100"
                    >
                      - {term.text}
                    </span>
                  ))}
                </div>

                <Link
                  href={`/player/${row.player_id}`}
                  className="mt-3 inline-block text-xs font-semibold uppercase tracking-[0.08em] text-lime-200 underline-offset-2 hover:underline"
                >
                  Open full card review
                </Link>
              </article>
            );
          })}
        </section>
      )}

      <LegalFooter />
    </main>
  );
}
