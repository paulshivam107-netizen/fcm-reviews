import { createIngestionDbClient } from "@/src/core/db/client";
import { createLogger } from "@/src/core/logging/logger";
import {
  PageType,
  ParsedOutput,
  ScrapeRunCounters,
  SourceAdapter,
} from "@/src/core/types/ingestion";
import { sha256 } from "@/src/core/utils/hash";
import { nowIso } from "@/src/core/utils/time";
import { discoverSourcePages } from "@/src/ingestion/discover/discoverSourcePages";
import { fetchPage } from "@/src/ingestion/fetch/fetchPage";
import { normalizeCardVersion } from "@/src/ingestion/normalize/normalizeCardVersion";
import { normalizeReview } from "@/src/ingestion/normalize/normalizeReview";
import { upsertCard } from "@/src/ingestion/upsert/upsertCard";
import { upsertMention } from "@/src/ingestion/upsert/upsertMention";
import { upsertReview } from "@/src/ingestion/upsert/upsertReview";
import {
  completeScrapeRun,
  createScrapeRun,
  recordScrapeFailure,
} from "@/src/ingestion/upsert/trackScrapeRun";

async function markSourcePageFetch(input: {
  url: string;
  status: number;
  contentHash: string;
}) {
  const db = createIngestionDbClient();
  await db.update({
    table: "source_pages",
    values: {
      last_fetched_at: nowIso(),
      last_http_status: input.status,
      last_content_hash: input.contentHash,
    },
    filters: {
      url: `eq.${input.url}`,
    },
  });
}

async function processParsedOutput(adapter: SourceAdapter, parsed: ParsedOutput) {
  let upserted = 0;

  for (const parsedCard of parsed.cards) {
    await upsertCard(normalizeCardVersion(parsedCard, adapter.name));
    upserted += 1;
  }

  for (const parsedReview of parsed.reviews) {
    await upsertReview(normalizeReview(parsedReview, adapter.name));
    upserted += 1;
  }

  for (const parsedMention of parsed.mentions) {
    await upsertMention(parsedMention, adapter.name);
    upserted += 1;
  }

  return upserted;
}

export async function runSharedJob(args: {
  jobName: string;
  pageType: PageType;
  adapters: SourceAdapter[];
  maxUrls: number;
}) {
  const logger = createLogger(`job:${args.jobName}`);
  const counters: ScrapeRunCounters = {
    discovered: 0,
    fetched: 0,
    parsed: 0,
    upserted: 0,
    failed: 0,
  };

  for (const adapter of args.adapters) {
    const run = await createScrapeRun({
      jobName: args.jobName,
      adapterName: adapter.name,
      pageType: adapter.pageType,
    });

    try {
      const runCounters: ScrapeRunCounters = {
        discovered: 0,
        fetched: 0,
        parsed: 0,
        upserted: 0,
        failed: 0,
      };
      const pages = await discoverSourcePages(adapter, args.maxUrls);
      counters.discovered += pages.length;
      runCounters.discovered += pages.length;

      for (const page of pages) {
        try {
          const fetchResult = await fetchPage(page.url, adapter.fetchMode);
          counters.fetched += 1;
          runCounters.fetched += 1;
          await markSourcePageFetch({
            url: page.url,
            status: fetchResult.status,
            contentHash: sha256(fetchResult.body),
          });

          const parsed = await adapter.parsePage(fetchResult, { nowIso: nowIso() });
          const parsedCount =
            parsed.cards.length + parsed.reviews.length + parsed.mentions.length;
          counters.parsed += parsedCount;
          runCounters.parsed += parsedCount;

          const upsertedCount = await processParsedOutput(adapter, parsed);
          counters.upserted += upsertedCount;
          runCounters.upserted += upsertedCount;
        } catch (error) {
          counters.failed += 1;
          runCounters.failed += 1;
          const errorMessage = error instanceof Error ? error.message : "Unknown ingestion error";
          logger.error("page ingestion failed", {
            adapter: adapter.name,
            pageType: adapter.pageType,
            url: page.url,
            errorMessage,
          });

          await recordScrapeFailure({
            runId: run.id,
            sourcePageId: null,
            adapterName: adapter.name,
            pageType: adapter.pageType,
            stage: "page",
            errorClass: error instanceof Error ? error.name : "Error",
            errorMessage,
            details: {
              url: page.url,
            },
          });
        }
      }

      await completeScrapeRun({
        runId: run.id,
        status: runCounters.failed > 0 ? "partial" : "completed",
        counters: runCounters,
        metadata: {
          adapters: args.adapters.map((entry) => entry.name),
        },
      });
    } catch (error) {
      counters.failed += 1;
      const runCounters: ScrapeRunCounters = {
        discovered: 0,
        fetched: 0,
        parsed: 0,
        upserted: 0,
        failed: 1,
      };
      const errorMessage = error instanceof Error ? error.message : "Unknown job error";
      logger.error("adapter job failed", {
        adapter: adapter.name,
        pageType: adapter.pageType,
        errorMessage,
      });

      await recordScrapeFailure({
        runId: run.id,
        sourcePageId: null,
        adapterName: adapter.name,
        pageType: adapter.pageType,
        stage: "adapter",
        errorClass: error instanceof Error ? error.name : "Error",
        errorMessage,
      });

      await completeScrapeRun({
        runId: run.id,
        status: "failed",
        counters: runCounters,
        metadata: {
          failedAdapter: adapter.name,
        },
      });
    }
  }

  logger.info("job completed", {
    jobName: args.jobName,
    counters,
  });

  return counters;
}
