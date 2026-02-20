"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { POSITION_GROUPS, TAB_LABELS, parseTab } from "@/lib/position-groups";
import { PlayersApiResponse, PlayerRow, PlayerTab } from "@/types/player";

type FetchState = "idle" | "loading" | "success" | "error";

function formatSentiment(score: number | null) {
  if (score === null || Number.isNaN(score)) return "N/A";
  return `${score.toFixed(1)}/10`;
}

function StarMeter({ score }: { score: number | null }) {
  if (score === null || Number.isNaN(score)) {
    return <span className="text-xs text-slate-400">No score yet</span>;
  }
  const filled = Math.max(0, Math.min(10, Math.round(score)));
  return (
    <span className="star-track text-accent-400">
      {"★".repeat(filled)}
      <span className="text-slate-500">{"★".repeat(10 - filled)}</span>
    </span>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div
          key={idx}
          className="glass-panel h-24 animate-pulse rounded-2xl border border-white/10"
        />
      ))}
    </div>
  );
}

function PlayerCard({ row, index }: { row: PlayerRow; index: number }) {
  return (
    <article
      className="glass-panel card-reveal rounded-2xl p-4 transition duration-300 hover:border-lime-300/50"
      style={{ animationDelay: `${Math.min(index * 45, 220)}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-100">
            {row.player_name}
          </h3>
          <p className="mt-1 text-sm text-slate-300">
            OVR {row.base_ovr} · {row.base_position}
          </p>
        </div>
        <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300">
          {row.program_promo}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">
            Sentiment
          </p>
          <p className="mt-1 text-sm font-semibold text-lime-300">
            {formatSentiment(row.avg_sentiment_score)}
          </p>
        </div>
        <StarMeter score={row.avg_sentiment_score} />
      </div>
    </article>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<PlayerTab>("attacker");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const tabList = useMemo(
    () => Object.keys(POSITION_GROUPS).map((tab) => parseTab(tab)),
    []
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setState("loading");
      setError(null);

      try {
        const params = new URLSearchParams({
          tab: activeTab,
          q: query,
          limit: "30",
        });
        const response = await fetch(`/api/players?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as PlayersApiResponse;
        if (!cancelled) {
          setRows(payload.items);
          setState("success");
        }
      } catch (err) {
        if (cancelled) return;
        setState("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, query]);

  const onSubmitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(queryDraft.trim());
  };

  return (
      <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <header className="mb-6">
        <p className="mb-2 inline-flex items-center rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          FC Mobile Reviews
        </p>
        <h1 className="text-2xl font-bold leading-tight text-slate-100 sm:text-3xl">
          Scout The Meta.
          <span className="block bg-gradient-to-r from-lime-200 to-lime-400 bg-clip-text text-transparent">
            Pick Better Players.
          </span>
        </h1>
        <p className="mt-2 max-w-[32ch] text-sm text-slate-300">
          Real community sentiment for the cards people actually use.
        </p>
      </header>

      <form onSubmit={onSubmitSearch} className="mb-5">
        <label htmlFor="player-search" className="sr-only">
          Search players
        </label>
        <div className="glass-panel flex items-center gap-2 rounded-2xl px-4 py-3">
          <span className="text-slate-300" aria-hidden>
            ⌕
          </span>
          <input
            id="player-search"
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search player or try “113 Messi”"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </form>

      <nav
        className="soft-scrollbar mb-6 flex snap-x gap-2 overflow-x-auto pb-2"
        aria-label="Player role tabs"
      >
        {tabList.map((tab) => {
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "shrink-0 snap-start rounded-full px-4 py-2 text-sm font-semibold transition",
                active
                  ? "bg-accent-500 text-slate-950 shadow-[0_8px_24px_rgba(184,245,106,0.22)]"
                  : "bg-[var(--bg-pill)] text-slate-300 hover:bg-white/10",
              ].join(" ")}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>

      <section className="space-y-3">
        {state === "loading" && <LoadingCards />}

        {state === "error" && (
          <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-rose-200">
            Failed to load players: {error}
          </div>
        )}

        {state === "success" && rows.length === 0 && (
          <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
            No players found for this filter yet.
          </div>
        )}

        {state === "success" &&
          rows.map((row, index) => (
            <PlayerCard key={row.player_id} row={row} index={index} />
          ))}
      </section>
    </main>
  );
}
