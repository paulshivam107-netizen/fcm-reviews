import { NextRequest, NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/lib/server/admin-session";

export async function POST(_request: NextRequest) {
  const response = NextResponse.json({ success: true }, { status: 200 });
  clearAdminSessionCookie(response);
  return response;
}

