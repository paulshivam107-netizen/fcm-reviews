import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION_COOKIE = "fcm_admin_session";
const SESSION_ISSUER = "fcm-reviews-admin";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type AdminSessionPayload = {
  email: string;
  iss: string;
  iat: number;
  exp: number;
};

function toBase64Url(input: Uint8Array | string) {
  const source =
    typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return source
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const normalized =
    remainder === 0 ? padded : `${padded}${"=".repeat(4 - remainder)}`;
  return Buffer.from(normalized, "base64");
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
}

export function getAdminAllowlist() {
  return String(process.env.ADMIN_ALLOWLIST_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmailAllowed(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const allowlist = getAdminAllowlist();
  return allowlist.includes(normalized);
}

function signPayload(payloadBase64: string, secret: string) {
  return toBase64Url(
    createHmac("sha256", secret).update(payloadBase64).digest()
  );
}

export function issueAdminSession(email: string) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    email: email.trim().toLowerCase(),
    iss: SESSION_ISSUER,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64, secret);
  return `${payloadBase64}.${signature}`;
}

function verifySignature(
  payloadBase64: string,
  signatureBase64: string,
  secret: string
) {
  const expected = signPayload(payloadBase64, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureBase64);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function verifyAdminSession(token: string) {
  const secret = getSessionSecret();
  if (!secret) {
    return {
      ok: false as const,
      reason: "ADMIN_SESSION_SECRET is not configured.",
    };
  }

  const [payloadBase64, signatureBase64] = token.split(".");
  if (!payloadBase64 || !signatureBase64) {
    return { ok: false as const, reason: "Invalid session token format." };
  }

  if (!verifySignature(payloadBase64, signatureBase64, secret)) {
    return { ok: false as const, reason: "Invalid session signature." };
  }

  let payload: AdminSessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadBase64).toString("utf8"));
  } catch {
    return { ok: false as const, reason: "Invalid session payload." };
  }

  if (payload.iss !== SESSION_ISSUER) {
    return { ok: false as const, reason: "Invalid session issuer." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    return { ok: false as const, reason: "Session expired." };
  }

  if (!isAdminEmailAllowed(payload.email)) {
    return { ok: false as const, reason: "Admin email not allowed." };
  }

  return {
    ok: true as const,
    session: {
      email: payload.email,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    },
  };
}

export function setAdminSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function requireAdminSession(request: NextRequest) {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? "";
  if (!token) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const verified = verifyAdminSession(token);
  if (!verified.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true as const, session: verified.session };
}
