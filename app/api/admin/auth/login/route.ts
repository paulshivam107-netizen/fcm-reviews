import { NextRequest, NextResponse } from "next/server";
import {
  getAdminAllowlist,
  isAdminEmailAllowed,
  issueAdminSession,
  setAdminSessionCookie,
} from "@/lib/server/admin-session";

type SupabasePasswordGrantResponse = {
  user?: {
    email?: string | null;
  };
};

function getSupabaseAuthConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey };
}

export async function POST(request: NextRequest) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const passwordValue = String(password ?? "");
    if (!normalizedEmail || !passwordValue) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const allowlist = getAdminAllowlist();
    if (!allowlist.length) {
      return NextResponse.json(
        { error: "ADMIN_ALLOWLIST_EMAILS is not configured." },
        { status: 500 }
      );
    }

    if (!isAdminEmailAllowed(normalizedEmail)) {
      return NextResponse.json(
        { error: "Email is not allowed for admin access." },
        { status: 403 }
      );
    }

    const authConfig = getSupabaseAuthConfig();
    if (!authConfig) {
      return NextResponse.json(
        {
          error:
            "Missing SUPABASE_URL and one of NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const loginResponse = await fetch(
      `${authConfig.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: authConfig.supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: passwordValue,
        }),
        cache: "no-store",
      }
    );

    if (!loginResponse.ok) {
      return NextResponse.json(
        { error: "Invalid admin credentials." },
        { status: 401 }
      );
    }

    const payload = (await loginResponse.json()) as SupabasePasswordGrantResponse;
    const authedEmail = String(payload.user?.email ?? "").trim().toLowerCase();
    if (!authedEmail || !isAdminEmailAllowed(authedEmail)) {
      return NextResponse.json(
        { error: "Email is not allowed for admin access." },
        { status: 403 }
      );
    }

    const sessionToken = issueAdminSession(authedEmail);
    const response = NextResponse.json(
      {
        success: true,
        email: authedEmail,
      },
      { status: 200 }
    );
    setAdminSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid login request.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

