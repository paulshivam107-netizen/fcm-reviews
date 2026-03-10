import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import {
  deleteRedditWatchlistEntry,
  listRedditWatchlist,
  updateRedditWatchlistEntry,
  upsertRedditWatchlistEntry,
} from "@/src/admin/reddit/service";
import {
  RedditWatchlistMutationResponse,
  RedditWatchlistResponse,
} from "@/types/admin-imports";

type SupabaseErrorShape = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

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

function getRedditWatchlistStorageError(raw: string) {
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
    const items = await listRedditWatchlist();
    const response: RedditWatchlistResponse = {
      items,
      meta: { count: items.length },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditWatchlistStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to fetch Reddit watchlist",
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
    const payload = (await request.json()) as {
      playerId?: string;
      searchTerms?: string[];
      subreddits?: string[];
      isActive?: boolean;
    };

    const playerId = String(payload.playerId ?? "").trim();
    if (!isUuidLike(playerId)) {
      return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
    }

    const item = await upsertRedditWatchlistEntry({
      playerId,
      searchTerms: Array.isArray(payload.searchTerms) ? payload.searchTerms : undefined,
      subreddits: Array.isArray(payload.subreddits) ? payload.subreddits : undefined,
      isActive: typeof payload.isActive === "boolean" ? payload.isActive : true,
    });

    const response: RedditWatchlistMutationResponse = {
      success: true,
      item,
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditWatchlistStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to save watchlist entry",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      id?: string;
      searchTerms?: string[];
      subreddits?: string[];
      isActive?: boolean;
    };

    const id = String(payload.id ?? "").trim();
    if (!isUuidLike(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const item = await updateRedditWatchlistEntry({
      id,
      searchTerms: Array.isArray(payload.searchTerms) ? payload.searchTerms : undefined,
      subreddits: Array.isArray(payload.subreddits) ? payload.subreddits : undefined,
      isActive: typeof payload.isActive === "boolean" ? payload.isActive : undefined,
    });

    const response: RedditWatchlistMutationResponse = {
      success: true,
      item,
    };
    return NextResponse.json(response);
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditWatchlistStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to update watchlist entry",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  const id = String(request.nextUrl.searchParams.get("id") ?? "").trim();
  if (!isUuidLike(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await deleteRedditWatchlistEntry(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditWatchlistStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to remove watchlist entry",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
