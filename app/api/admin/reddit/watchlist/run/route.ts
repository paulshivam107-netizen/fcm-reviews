import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import { runRedditWatchlistSync } from "@/src/admin/reddit/service";

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
    return NextResponse.json(
      {
        error: "Failed to run Reddit watchlist sync",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
