import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import {
  getRedditImportSettings,
  updateRedditImportSettings,
} from "@/src/admin/reddit/service";
import { RedditImportSettings, RedditImportSettingsResponse } from "@/types/admin-imports";

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

function getRedditImportSettingsStorageError(raw: string) {
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
    (combined.includes("pgrst205") && combined.includes("admin_runtime_settings")) ||
    combined.includes('relation "admin_runtime_settings" does not exist')
  ) {
    return {
      error:
        "Admin runtime settings storage is not initialized. Run migration 20260311110000_admin_runtime_settings.sql in Supabase SQL editor.",
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
        "Reddit import settings require SUPABASE_SERVICE_ROLE_KEY. Update Railway variable and redeploy.",
      status: 500,
    };
  }

  return null;
}

function normalizeInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const settings = await getRedditImportSettings();
    const response: RedditImportSettingsResponse = { settings };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditImportSettingsStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to fetch Reddit import settings",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as Partial<RedditImportSettings>;
    const settings = await updateRedditImportSettings({
      currentMaxBaseOvr: normalizeInt(payload.currentMaxBaseOvr, 117),
      maxRankOvrBoost: normalizeInt(payload.maxRankOvrBoost, 5),
    });
    const response: RedditImportSettingsResponse = { settings };
    return NextResponse.json(response);
  } catch (error) {
    const storageError =
      error instanceof Error ? getRedditImportSettingsStorageError(error.message) : null;
    if (storageError) {
      return NextResponse.json({ error: storageError.error }, { status: storageError.status });
    }
    return NextResponse.json(
      {
        error: "Failed to update Reddit import settings",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
