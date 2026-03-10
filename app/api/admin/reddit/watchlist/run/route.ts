import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import {
  listRedditWatchlistRuns,
  runRedditWatchlistSync,
} from "@/src/admin/reddit/service";
import { RedditWatchlistRunHistoryResponse } from "@/types/admin-imports";

type SupabaseErrorShape = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function parseSupabaseErrorBody(raw: string): SupabaseErrorShape {
  const match = raw.match(/\{[\s\S]*\}$/);
  const candidate = match ? match[0] : raw;
  try {
    const parsed = JSON.parse(candidate) as SupabaseErrorShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getRedditWatchlistRunStorageError(raw: string) {
  const parsed = parseSupabaseErrorBody(raw);
  const combined = [
    parsed.code ?? "",
    parsed.message ?? "",
    parsed.details ?? "",
    parsed.hint ?? "",
    raw,
  ]
    .join(" ")
    .toLowerCase();

  if (
    (combined.includes("pgrst205") &&
      combined.includes("reddit_watchlist_entries")) ||
    combined.includes('relation "reddit_watchlist_entries" does not exist')
  ) {
    return {
      error:
        "Reddit watchlist storage is not initialized. Run migration 20260310121000_reddit_watchlist_entries.sql in Supabase SQL editor.",
      status: 503,
    };
  }

  if (
    (combined.includes("pgrst205") && combined.includes("ingest_runs")) ||
    combined.includes('relation "ingest_runs" does not exist')
  ) {
    return {
      error:
        "Reddit ingestion run storage is not initialized. Run the Reddit pipeline migrations in Supabase before using watchlist sync.",
      status: 503,
    };
  }

  if (
    combined.includes("42501") ||
    combined.includes("permission denied") ||
    combined.includes("insufficient_privilege") ||
    combined.includes("forbidden")
  ) {
    return {
      error:
        "Reddit watchlist admin tools require SUPABASE_SERVICE_ROLE_KEY. Update Railway variable and redeploy.",
      status: 500,
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "12", 10);
    const items = await listRedditWatchlistRuns(limit);
    const response: RedditWatchlistRunHistoryResponse = {
      items,
      meta: { count: items.length },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditWatchlistRunStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to fetch watchlist runs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json().catch(() => ({}))) as {
      limitPerEntry?: number;
    };

    const result = await runRedditWatchlistSync({
      limitPerEntry: payload.limitPerEntry,
      mode: "admin",
    });

    return NextResponse.json(result);
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditWatchlistRunStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to run Reddit watchlist sync",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
