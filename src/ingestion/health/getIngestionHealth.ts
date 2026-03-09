import { createIngestionDbClient } from "@/src/core/db/client";

export type IngestionHealthSnapshot = {
  recentRuns: Array<{
    id: string;
    jobName: string;
    adapterName: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    failedCount: number;
    upsertedCount: number;
  }>;
  failureCount24h: number;
  activeSourcePages: number;
};

type ScrapeRunRow = {
  id: string;
  job_name: string;
  adapter_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  failed_count: number;
  upserted_count: number;
};

type FailureRow = {
  id: string;
};

type SourcePageRow = {
  id: string;
};

export async function getIngestionHealth(): Promise<IngestionHealthSnapshot> {
  const db = createIngestionDbClient();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [recentRuns, recentFailures, sourcePages] = await Promise.all([
    db.select<ScrapeRunRow[]>({
      table: "scrape_runs",
      select: "id,job_name,adapter_name,status,started_at,completed_at,failed_count,upserted_count",
      order: "started_at.desc",
      limit: 10,
    }),
    db.select<FailureRow[]>({
      table: "scrape_failures",
      select: "id",
      filters: {
        occurred_at: `gte.${sinceIso}`,
      },
      limit: 200,
    }),
    db.select<SourcePageRow[]>({
      table: "source_pages",
      select: "id",
      limit: 5000,
    }),
  ]);

  return {
    recentRuns: recentRuns.map((row) => ({
      id: row.id,
      jobName: row.job_name,
      adapterName: row.adapter_name,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      failedCount: row.failed_count,
      upsertedCount: row.upserted_count,
    })),
    failureCount24h: recentFailures.length,
    activeSourcePages: sourcePages.length,
  };
}
