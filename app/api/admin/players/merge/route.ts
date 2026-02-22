import { NextRequest, NextResponse } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { requireAdminSession } from "@/lib/server/admin-session";
import { supabaseRpcRequest } from "@/lib/server/supabase-admin";
import {
  AdminPlayerMergeExecuteResponse,
  AdminPlayerMergePreview,
  AdminPlayerMergePreviewResponse,
} from "@/types/admin";

type MergeSummaryRow = AdminPlayerMergeExecuteResponse["summary"];

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseRpcErrorMessage(details: string) {
  try {
    const parsed = JSON.parse(details) as {
      message?: string;
      hint?: string;
      details?: string;
    };
    const message =
      parsed.message ??
      parsed.details ??
      "Supabase RPC request failed.";
    const hint = parsed.hint ? ` (${parsed.hint})` : "";
    return `${message}${hint}`;
  } catch {
    return details.slice(0, 500) || "Supabase RPC request failed.";
  }
}

function parseIdsFromSearchParams(request: NextRequest) {
  const sourcePlayerId = String(
    request.nextUrl.searchParams.get("sourcePlayerId") ?? ""
  ).trim();
  const targetPlayerId = String(
    request.nextUrl.searchParams.get("targetPlayerId") ?? ""
  ).trim();
  return { sourcePlayerId, targetPlayerId };
}

function parseIdsFromBody(payload: unknown) {
  const record = payload as { sourcePlayerId?: string; targetPlayerId?: string };
  return {
    sourcePlayerId: String(record.sourcePlayerId ?? "").trim(),
    targetPlayerId: String(record.targetPlayerId ?? "").trim(),
  };
}

function validateIds(sourcePlayerId: string, targetPlayerId: string) {
  if (!isUuidLike(sourcePlayerId)) return "Invalid sourcePlayerId";
  if (!isUuidLike(targetPlayerId)) return "Invalid targetPlayerId";
  if (sourcePlayerId === targetPlayerId) {
    return "Source and target must be different cards.";
  }
  return null;
}

function normalizePreview(raw: unknown): AdminPlayerMergePreview | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (!payload.sourcePlayer || !payload.targetPlayer || !payload.sourceCounts) {
    return null;
  }
  return payload as unknown as AdminPlayerMergePreview;
}

function normalizeMergeSummary(raw: unknown): MergeSummaryRow | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  if (!payload.auditId || !payload.sourcePlayerId || !payload.targetPlayerId) {
    return null;
  }
  return payload as unknown as MergeSummaryRow;
}

function isLocalMockMode() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return shouldUseLocalMockData(supabaseUrl, supabaseKey);
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  if (isLocalMockMode()) {
    return NextResponse.json(
      { error: "Card merge preview is unavailable in local mock mode." },
      { status: 400 }
    );
  }

  const { sourcePlayerId, targetPlayerId } = parseIdsFromSearchParams(request);
  const idValidationError = validateIds(sourcePlayerId, targetPlayerId);
  if (idValidationError) {
    return NextResponse.json({ error: idValidationError }, { status: 400 });
  }

  try {
    const rpcResponse = await supabaseRpcRequest({
      endpoint: "preview_player_card_merge",
      body: {
        p_source_player_id: sourcePlayerId,
        p_target_player_id: targetPlayerId,
      },
    });

    if (!rpcResponse.ok) {
      const details = await rpcResponse.text();
      return NextResponse.json(
        {
          error: "Failed to preview card merge",
          details: parseRpcErrorMessage(details),
        },
        { status: 500 }
      );
    }

    const rawPayload = (await rpcResponse.json()) as unknown;
    const preview = normalizePreview(rawPayload);
    if (!preview) {
      return NextResponse.json(
        { error: "Merge preview returned an invalid payload." },
        { status: 500 }
      );
    }

    const response: AdminPlayerMergePreviewResponse = { preview };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to preview card merge",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  if (isLocalMockMode()) {
    return NextResponse.json(
      { error: "Card merge is unavailable in local mock mode." },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as unknown;
    const { sourcePlayerId, targetPlayerId } = parseIdsFromBody(body);
    const idValidationError = validateIds(sourcePlayerId, targetPlayerId);
    if (idValidationError) {
      return NextResponse.json({ error: idValidationError }, { status: 400 });
    }

    const rpcResponse = await supabaseRpcRequest({
      endpoint: "merge_player_cards",
      body: {
        p_source_player_id: sourcePlayerId,
        p_target_player_id: targetPlayerId,
        p_merged_by_email: auth.session.email,
      },
    });

    if (!rpcResponse.ok) {
      const details = await rpcResponse.text();
      return NextResponse.json(
        {
          error: "Failed to merge cards",
          details: parseRpcErrorMessage(details),
        },
        { status: 500 }
      );
    }

    const rawPayload = (await rpcResponse.json()) as unknown;
    const summary = normalizeMergeSummary(rawPayload);
    if (!summary) {
      return NextResponse.json(
        { error: "Merge RPC returned an invalid payload." },
        { status: 500 }
      );
    }

    const response: AdminPlayerMergeExecuteResponse = {
      success: true,
      summary,
      refreshed: true,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid merge request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
