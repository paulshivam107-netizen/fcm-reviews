import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { requireAdminSession } from "@/lib/server/admin-session";
import { supabaseRestRequest } from "@/lib/server/supabase-admin";
import {
  AdminFeedbackModerationResponse,
  AdminFeedbackQueueItem,
  AdminFeedbackQueueResponse,
  FeedbackModerationStatus,
  UserFeedbackCategory,
} from "@/types/feedback";

const MAX_LIST_LIMIT = 120;
const FEEDBACK_STATUS_VALUES: FeedbackModerationStatus[] = [
  "pending",
  "reviewed",
  "resolved",
];

const FEEDBACK_CATEGORIES = new Set<UserFeedbackCategory>([
  "review_feedback",
  "general_feedback",
  "improvement_suggestion",
]);

type SupabaseFeedbackRow = {
  id: string;
  category: string;
  message: string;
  contact: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

type SupabaseErrorShape = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type LocalFeedbackQueueItem = AdminFeedbackQueueItem;

declare global {
  // eslint-disable-next-line no-var
  var __fcmLocalAdminFeedbackQueue: LocalFeedbackQueueItem[] | undefined;
}

function parseStatus(value: string | null): FeedbackModerationStatus {
  if (value === "reviewed" || value === "resolved") return value;
  return "pending";
}

function parseLimit(value: string | null) {
  const raw = Number.parseInt(value ?? "60", 10);
  if (!Number.isFinite(raw)) return 60;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, raw));
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseTargetStatus(value: unknown): FeedbackModerationStatus | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (FEEDBACK_STATUS_VALUES.includes(normalized as FeedbackModerationStatus)) {
    return normalized as FeedbackModerationStatus;
  }
  return null;
}

function normalizeCategory(value: string): UserFeedbackCategory {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (FEEDBACK_CATEGORIES.has(normalized as UserFeedbackCategory)) {
    return normalized as UserFeedbackCategory;
  }
  return "general_feedback";
}

function toQueueResponse(
  status: FeedbackModerationStatus,
  items: AdminFeedbackQueueItem[]
) {
  const payload: AdminFeedbackQueueResponse = {
    items,
    meta: {
      status,
      count: items.length,
    },
  };
  return NextResponse.json(payload);
}

function getLocalQueueStore() {
  if (globalThis.__fcmLocalAdminFeedbackQueue) {
    return globalThis.__fcmLocalAdminFeedbackQueue;
  }

  const now = new Date().toISOString();
  globalThis.__fcmLocalAdminFeedbackQueue = [
    {
      submissionId: randomUUID(),
      category: "general_feedback",
      message:
        "Search results should show cards even if I am on a different role tab.",
      contact: "sample_user",
      status: "pending",
      createdAt: now,
      reviewedAt: null,
      reviewNote: null,
    },
  ];

  return globalThis.__fcmLocalAdminFeedbackQueue;
}

function parseSupabaseErrorBody(raw: string): SupabaseErrorShape {
  try {
    const parsed = JSON.parse(raw) as SupabaseErrorShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getFeedbackStorageError(raw: string) {
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
      combined.includes("user_feedback_submissions")) ||
    combined.includes('relation "user_feedback_submissions" does not exist')
  ) {
    return {
      error:
        "Feedback storage is not initialized. Run migration 20260304182000_user_feedback_submissions.sql in Supabase SQL editor.",
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
        "Feedback moderation requires SUPABASE_SERVICE_ROLE_KEY. Update Railway variable and redeploy.",
      status: 500,
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  const status = parseStatus(request.nextUrl.searchParams.get("status"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

  if (useLocalMockData) {
    const items = getLocalQueueStore()
      .filter((item) => item.status === status)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .slice(0, limit);
    return toQueueResponse(status, items);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          "Feedback moderation requires SUPABASE_SERVICE_ROLE_KEY. Update Railway variable and redeploy.",
      },
      { status: 500 }
    );
  }

  try {
    const response = await supabaseRestRequest({
      endpoint: "user_feedback_submissions",
      method: "GET",
      query: {
        select: [
          "id",
          "category",
          "message",
          "contact",
          "status",
          "created_at",
          "reviewed_at",
          "review_note",
        ].join(","),
        status: `eq.${status}`,
        order: "created_at.asc",
        limit: String(limit),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      const storageError = getFeedbackStorageError(details);
      if (storageError) {
        return NextResponse.json(
          { error: storageError.error },
          { status: storageError.status }
        );
      }
      return NextResponse.json(
        { error: "Failed to fetch feedback queue", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const rows = (await response.json()) as SupabaseFeedbackRow[];
    const items: AdminFeedbackQueueItem[] = rows.map((row) => ({
      submissionId: row.id,
      category: normalizeCategory(row.category),
      message: row.message,
      contact: row.contact,
      status: parseStatus(row.status),
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
    }));

    return toQueueResponse(status, items);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load feedback queue",
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
    const payload = (await request.json()) as {
      submissionId?: string;
      status?: FeedbackModerationStatus;
      reviewNote?: string | null;
    };

    const submissionId = String(payload.submissionId ?? "").trim();
    const status = parseTargetStatus(payload.status);
    const reviewNote =
      String(payload.reviewNote ?? "").replace(/\s+/g, " ").trim().slice(0, 400) ||
      null;

    if (!isUuidLike(submissionId)) {
      return NextResponse.json({ error: "Invalid submissionId" }, { status: 400 });
    }
    if (!status) {
      return NextResponse.json({ error: "Invalid target status" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const store = getLocalQueueStore();
      const target = store.find((item) => item.submissionId === submissionId);
      if (!target) {
        return NextResponse.json(
          { error: "Feedback submission not found" },
          { status: 404 }
        );
      }
      target.status = status;
      target.reviewedAt = status === "pending" ? null : new Date().toISOString();
      target.reviewNote = reviewNote;
      const response: AdminFeedbackModerationResponse = {
        success: true,
        status,
      };
      return NextResponse.json(response);
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      return NextResponse.json(
        {
          error:
            "Feedback moderation requires SUPABASE_SERVICE_ROLE_KEY. Update Railway variable and redeploy.",
        },
        { status: 500 }
      );
    }

    const updateResponse = await supabaseRestRequest({
      endpoint: "user_feedback_submissions",
      method: "PATCH",
      prefer: "return=representation",
      query: {
        id: `eq.${submissionId}`,
      },
      body: {
        status,
        reviewed_at: status === "pending" ? null : new Date().toISOString(),
        review_note: reviewNote,
      },
      cache: "no-store",
    });

    if (!updateResponse.ok) {
      const details = await updateResponse.text();
      const storageError = getFeedbackStorageError(details);
      if (storageError) {
        return NextResponse.json(
          { error: storageError.error },
          { status: storageError.status }
        );
      }
      return NextResponse.json(
        { error: "Failed to update feedback submission", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const rows = (await updateResponse.json()) as Array<{ id: string; status: string }>;
    if (!rows.length) {
      return NextResponse.json(
        { error: "Feedback submission not found" },
        { status: 404 }
      );
    }

    const response: AdminFeedbackModerationResponse = {
      success: true,
      status: parseStatus(rows[0].status),
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to moderate feedback",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
