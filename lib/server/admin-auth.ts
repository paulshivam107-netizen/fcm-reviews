import { NextRequest, NextResponse } from "next/server";

function parseBearerToken(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  return trimmed.slice(7).trim() || null;
}

export function getAdminTokenFromRequest(request: NextRequest) {
  return (
    request.headers.get("x-admin-token") ??
    parseBearerToken(request.headers.get("authorization"))
  );
}

export function requireAdminToken(request: NextRequest) {
  const expected = process.env.ADMIN_API_TOKEN?.trim() ?? "";
  if (!expected) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "ADMIN_API_TOKEN is not configured on server." },
        { status: 500 }
      ),
    };
  }

  const provided = getAdminTokenFromRequest(request)?.trim() ?? "";
  if (!provided || provided !== expected) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true as const };
}

