import { ingestionConfig, sourceAdapters } from "@/src/config/ingestion";
import { runSharedJob } from "@/src/ingestion/jobs/runSharedJob";

export async function runCardSync() {
  const adapters = sourceAdapters.filter((adapter) => adapter.pageType === "card");
  return runSharedJob({
    jobName: "card-sync",
    pageType: "card",
    adapters,
    maxUrls: ingestionConfig.defaultDiscoverLimit,
  });
}
