import { ingestionConfig, sourceAdapters } from "@/src/config/ingestion";
import { runSharedJob } from "@/src/ingestion/jobs/runSharedJob";

export async function runReviewSync() {
  const adapters = sourceAdapters.filter((adapter) => adapter.pageType === "review");
  return runSharedJob({
    jobName: "review-sync",
    pageType: "review",
    adapters,
    maxUrls: ingestionConfig.defaultDiscoverLimit,
  });
}
