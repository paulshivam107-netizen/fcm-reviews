import { ingestionConfig, sourceAdapters } from "@/src/config/ingestion";
import { runSharedJob } from "@/src/ingestion/jobs/runSharedJob";

export async function runCommunitySync() {
  const adapters = sourceAdapters.filter((adapter) => adapter.pageType === "community");
  return runSharedJob({
    jobName: "community-sync",
    pageType: "community",
    adapters,
    maxUrls: ingestionConfig.defaultDiscoverLimit,
  });
}
