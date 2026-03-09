import { createIngestionDbClient } from "@/src/core/db/client";
import { PageType, ScrapeRunCounters } from "@/src/core/types/ingestion";

export async function createScrapeRun(input: {
  jobName: string;
  adapterName: string;
  pageType: PageType;
}) {
  const db = createIngestionDbClient();
  const [row] = await db.insert<Array<{ id: string }>>("scrape_runs", {
    job_name: input.jobName,
    adapter_name: input.adapterName,
    page_type: input.pageType,
    status: "running",
    started_at: new Date().toISOString(),
    discovered_count: 0,
    fetched_count: 0,
    parsed_count: 0,
    upserted_count: 0,
    failed_count: 0,
  });

  return row;
}

export async function completeScrapeRun(input: {
  runId: string;
  status: "completed" | "partial" | "failed";
  counters: ScrapeRunCounters;
  metadata?: Record<string, unknown>;
}) {
  const db = createIngestionDbClient();
  await db.update({
    table: "scrape_runs",
    values: {
      status: input.status,
      completed_at: new Date().toISOString(),
      discovered_count: input.counters.discovered,
      fetched_count: input.counters.fetched,
      parsed_count: input.counters.parsed,
      upserted_count: input.counters.upserted,
      failed_count: input.counters.failed,
      metadata: input.metadata ?? {},
    },
    filters: { id: `eq.${input.runId}` },
  });
}

export async function recordScrapeFailure(input: {
  runId: string;
  sourcePageId: string | null;
  adapterName: string;
  pageType: PageType;
  stage: string;
  errorClass: string;
  errorMessage: string;
  details?: Record<string, unknown>;
}) {
  const db = createIngestionDbClient();
  await db.insert("scrape_failures", {
    scrape_run_id: input.runId,
    source_page_id: input.sourcePageId,
    adapter_name: input.adapterName,
    page_type: input.pageType,
    stage: input.stage,
    error_class: input.errorClass,
    error_message: input.errorMessage,
    details: input.details ?? {},
    occurred_at: new Date().toISOString(),
  });
}
