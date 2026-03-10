import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import { previewRedditImport } from "@/src/admin/reddit/service";
import { AdminRedditImportPreviewResponse } from "@/types/admin-imports";

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      sourceUrl?: string | null;
      rawText?: string | null;
      subreddit?: string | null;
      playerName?: string | null;
      playerOvr?: number | null;
      eventName?: string | null;
      playedPosition?: string | null;
    };

    const preview = await previewRedditImport(payload);
    const response: AdminRedditImportPreviewResponse = { preview };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to preview Reddit import",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
