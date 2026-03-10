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

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
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
    return NextResponse.json(
      {
        error: "Failed to remove watchlist entry",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
