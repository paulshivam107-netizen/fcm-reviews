import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      authenticated: true,
      email: auth.session.email,
      expiresAt: auth.session.expiresAt,
    },
    { status: 200 }
  );
}

