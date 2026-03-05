import { NextRequest, NextResponse } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { requireAdminSession } from "@/lib/server/admin-session";
import { supabaseRpcRequest } from "@/lib/server/supabase-admin";
import {
  AdminDashboardResponse,
  AdminDashboardSnapshot,
} from "@/types/admin-dashboard";

type RpcRow = {
  window_days: number | string | null;
  unique_visitors_24h: number | string | null;
  unique_visitors_window: number | string | null;
  searches_24h: number | string | null;
  card_opens_24h: number | string | null;
  review_submissions_24h: number | string | null;
  reviews_pending: number | string | null;
  reviews_approved_24h: number | string | null;
  reviews_rejected_24h: number | string | null;
  review_approval_rate_24h: number | string | null;
  feedback_submissions_24h: number | string | null;
  feedback_pending: number | string | null;
  feedback_reviewed_24h: number | string | null;
  feedback_resolved_24h: number | string | null;
  open_from_search_rate_pct: number | string | null;
  review_submit_rate_pct: number | string | null;
};

function toInt(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function toRate(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
}

function parseWindowDays(raw: string | null) {
  const parsed = Number.parseInt(raw ?? "7", 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(30, Math.max(1, parsed));
}

function parseError(raw: string) {
  try {
    const parsed = JSON.parse(raw) as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    };
    return parsed;
  } catch {
    return {};
  }
}

function missingDashboardFunction(raw: string) {
  const parsed = parseError(raw);
  const combined = [
    parsed.code ?? "",
    parsed.message ?? "",
    parsed.details ?? "",
    parsed.hint ?? "",
    raw,
  ]
    .join(" ")
    .toLowerCase();

  return (
    combined.includes("admin_dashboard_snapshot") &&
    (combined.includes("does not exist") || combined.includes("pgrst202"))
  );
}

function buildMockSnapshot(windowDays: number): AdminDashboardSnapshot {
  return {
    windowDays,
    uniqueVisitors24h: 19,
    uniqueVisitorsWindow: 77,
    searches24h: 44,
    cardOpens24h: 31,
    reviewSubmissions24h: 6,
    reviewsPending: 5,
    reviewsApproved24h: 3,
    reviewsRejected24h: 1,
    reviewApprovalRate24h: 75,
    feedbackSubmissions24h: 3,
    feedbackPending: 2,
    feedbackReviewed24h: 1,
    feedbackResolved24h: 0,
    openFromSearchRatePct: 70.45,
    reviewSubmitRatePct: 19.35,
  };
}

function mapSnapshot(row: RpcRow): AdminDashboardSnapshot {
  return {
    windowDays: toInt(row.window_days),
    uniqueVisitors24h: toInt(row.unique_visitors_24h),
    uniqueVisitorsWindow: toInt(row.unique_visitors_window),
    searches24h: toInt(row.searches_24h),
    cardOpens24h: toInt(row.card_opens_24h),
    reviewSubmissions24h: toInt(row.review_submissions_24h),
    reviewsPending: toInt(row.reviews_pending),
    reviewsApproved24h: toInt(row.reviews_approved_24h),
    reviewsRejected24h: toInt(row.reviews_rejected_24h),
    reviewApprovalRate24h: toRate(row.review_approval_rate_24h),
    feedbackSubmissions24h: toInt(row.feedback_submissions_24h),
    feedbackPending: toInt(row.feedback_pending),
    feedbackReviewed24h: toInt(row.feedback_reviewed_24h),
    feedbackResolved24h: toInt(row.feedback_resolved_24h),
    openFromSearchRatePct: toRate(row.open_from_search_rate_pct),
    reviewSubmitRatePct: toRate(row.review_submit_rate_pct),
  };
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  const windowDays = parseWindowDays(request.nextUrl.searchParams.get("windowDays"));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

  if (useLocalMockData) {
    const response: AdminDashboardResponse = {
      snapshot: buildMockSnapshot(windowDays),
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(response);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Admin dashboard requires SUPABASE_SERVICE_ROLE_KEY. Update Railway variable and redeploy.",
      },
      { status: 500 }
    );
  }

  try {
    const rpcResponse = await supabaseRpcRequest({
      endpoint: "admin_dashboard_snapshot",
      body: { p_window_days: windowDays },
    });

    if (!rpcResponse.ok) {
      const details = await rpcResponse.text();
      if (missingDashboardFunction(details)) {
        return NextResponse.json(
          {
            error:
              "Dashboard function is not initialized. Run migration 20260305193000_admin_dashboard_snapshot.sql in Supabase SQL editor.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        {
          error: "Failed to load admin dashboard snapshot",
          details: details.slice(0, 500),
        },
        { status: 500 }
      );
    }

    const rows = (await rpcResponse.json()) as RpcRow[];
    const first = rows[0];
    if (!first) {
      return NextResponse.json(
        { error: "Dashboard snapshot returned no rows." },
        { status: 500 }
      );
    }

    const response: AdminDashboardResponse = {
      snapshot: mapSnapshot(first),
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load dashboard",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
