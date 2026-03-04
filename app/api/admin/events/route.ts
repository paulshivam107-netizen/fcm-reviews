import { NextRequest, NextResponse } from "next/server";
import { LOCAL_MOCK_PLAYERS, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { requireAdminSession } from "@/lib/server/admin-session";
import { supabaseRestRequest } from "@/lib/server/supabase-admin";
import { AdminEventOptionsResponse } from "@/types/admin";

const DEFAULT_LIMIT = 200;
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

type SupabaseEventRow = {
  program_promo: string | null;
};

function parseLimit(value: string | null) {
  const raw = Number.parseInt(value ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, raw));
}

function parseIncludeInactive(value: string | null) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function normalizeFreeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildResponse(items: string[]) {
  const payload: AdminEventOptionsResponse = {
    items,
    meta: {
      count: items.length,
    },
  };
  return NextResponse.json(payload);
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  const includeInactive = parseIncludeInactive(
    request.nextUrl.searchParams.get("includeInactive")
  );
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

  if (useLocalMockData) {
    const deduped = new Map<string, string>();
    for (const row of LOCAL_MOCK_PLAYERS) {
      const normalized = normalizeFreeText(row.program_promo);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, normalized);
      }
    }

    const items = Array.from(deduped.values())
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);
    return buildResponse(items);
  }

  try {
    const query: Record<string, string> = {
      select: "program_promo",
      order: "program_promo.asc",
      limit: String(limit),
    };

    if (!includeInactive) {
      query.is_active = "eq.true";
    }

    const response = await supabaseRestRequest({
      endpoint: "players",
      method: "GET",
      query,
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch events", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const rows = (await response.json()) as SupabaseEventRow[];
    const deduped = new Map<string, string>();

    for (const row of rows) {
      const normalized = normalizeFreeText(row.program_promo);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, normalized);
      }
    }

    const items = Array.from(deduped.values()).sort((a, b) => a.localeCompare(b));
    return buildResponse(items);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load events",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
