import { FetchResult, FetchMode } from "@/src/core/types/ingestion";
import { fetchWithApi } from "@/src/ingestion/fetch/fetchWithApi";
import { fetchWithHttp } from "@/src/ingestion/fetch/fetchWithHttp";

export async function fetchPage(url: string, fetchMode: FetchMode): Promise<FetchResult> {
  if (fetchMode === "http") {
    return fetchWithHttp(url);
  }

  if (fetchMode === "api") {
    return fetchWithApi(url);
  }

  // TODO: Add Scrapling worker handoff when the Python worker contract is finalized.
  throw new Error(`Fetch mode '${fetchMode}' is not wired yet`);
}
