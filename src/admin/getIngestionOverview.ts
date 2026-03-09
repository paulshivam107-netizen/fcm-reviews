import { getIngestionHealth } from "@/src/ingestion/health/getIngestionHealth";

export async function getIngestionOverview() {
  const health = await getIngestionHealth();

  return {
    headline: "Ingestion pipeline overview",
    summary: {
      recentRuns: health.recentRuns.length,
      failuresLast24h: health.failureCount24h,
      trackedSourcePages: health.activeSourcePages,
    },
    health,
  };
}
