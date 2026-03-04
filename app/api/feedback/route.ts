import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { supabaseRestRequest } from "@/lib/server/supabase-admin";
import {
  FeedbackSubmissionRequest,
  FeedbackSubmissionResponse,
  UserFeedbackCategory,
} from "@/types/feedback";

const MAX_MESSAGE_LENGTH = 1200;
const MIN_MESSAGE_LENGTH = 12;
const MAX_CONTACT_LENGTH = 32;
const MAX_SUBMISSIONS_PER_24H = 5;
const CAPTCHA_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const FEEDBACK_CATEGORIES = new Set<UserFeedbackCategory>([
  "review_feedback",
  "general_feedback",
  "improvement_suggestion",
]);

type LocalSubmission = {
  id: string;
  submission_fingerprint: string;
  created_at: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __fcmLocalFeedbackSubmissions: LocalSubmission[] | undefined;
}

function normalizeFreeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategory(value: string | null | undefined): UserFeedbackCategory | null {
  const normalized = normalizeFreeText(value).toLowerCase();
  if (!normalized) return null;
  if (FEEDBACK_CATEGORIES.has(normalized as UserFeedbackCategory)) {
    return normalized as UserFeedbackCategory;
  }
  return null;
}

function isCaptchaRequired() {
  const raw = String(
    process.env.REVIEW_CAPTCHA_REQUIRED ??
      (process.env.NODE_ENV === "production" ? "true" : "false")
  )
    .trim()
    .toLowerCase();
  return raw !== "false";
}

async function verifyTurnstileToken(args: {
  token: string;
  ip: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    return { ok: !isCaptchaRequired(), reason: "Captcha is not configured" };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", args.token);
  if (args.ip && args.ip !== "unknown") {
    form.set("remoteip", args.ip);
  }

  const response = await fetch(CAPTCHA_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    return { ok: false, reason: "Captcha verification failed" };
  }

  const payload = (await response.json()) as {
    success?: boolean;
    "error-codes"?: string[];
  };
  if (!payload.success) {
    const reason = Array.isArray(payload["error-codes"])
      ? payload["error-codes"].join(", ")
      : "invalid-token";
    return { ok: false, reason };
  }

  return { ok: true };
}

function getClientIdentity(request: NextRequest) {
  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.REVIEW_FINGERPRINT_SALT ?? "fcm-reviews";
  const fingerprint = createHash("sha256")
    .update(`${ip}|${userAgent}|${salt}`)
    .digest("hex");
  return { ip, userAgent, fingerprint };
}

function getLocalSubmissionStore(): LocalSubmission[] {
  if (globalThis.__fcmLocalFeedbackSubmissions) {
    return globalThis.__fcmLocalFeedbackSubmissions;
  }

  globalThis.__fcmLocalFeedbackSubmissions = [];
  return globalThis.__fcmLocalFeedbackSubmissions;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as FeedbackSubmissionRequest;
    const honeypot = String(payload.honeypot ?? "").trim();
    if (honeypot) {
      const decoyResponse: FeedbackSubmissionResponse = {
        success: true,
        status: "pending",
        submissionId: randomUUID(),
        message: "Feedback submitted. Thanks for helping improve the app.",
      };
      return NextResponse.json(decoyResponse, { status: 201 });
    }

    const category = normalizeCategory(payload.category);
    if (!category) {
      return NextResponse.json(
        { error: "Invalid feedback category." },
        { status: 400 }
      );
    }

    const message = normalizeFreeText(payload.message).slice(0, MAX_MESSAGE_LENGTH);
    if (message.length < MIN_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message must be at least ${MIN_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const contact =
      normalizeFreeText(payload.contact).slice(0, MAX_CONTACT_LENGTH) || null;
    const captchaToken = String(payload.captchaToken ?? "").trim();
    const { ip, userAgent, fingerprint } = getClientIdentity(request);

    if (!captchaToken && isCaptchaRequired()) {
      return NextResponse.json(
        { error: "Captcha token is required." },
        { status: 400 }
      );
    }

    if (captchaToken || isCaptchaRequired()) {
      const captchaCheck = await verifyTurnstileToken({ token: captchaToken, ip });
      if (!captchaCheck.ok) {
        return NextResponse.json(
          {
            error: "Captcha verification failed.",
            details: captchaCheck.reason ?? "invalid token",
          },
          { status: 400 }
        );
      }
    }

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const store = getLocalSubmissionStore();
      const recentCount = store.filter(
        (row) =>
          row.submission_fingerprint === fingerprint &&
          row.created_at >= sinceIso
      ).length;
      if (recentCount >= MAX_SUBMISSIONS_PER_24H) {
        return NextResponse.json(
          {
            error: `Submission limit reached. You can submit up to ${MAX_SUBMISSIONS_PER_24H} feedback entries in 24 hours.`,
          },
          { status: 429 }
        );
      }

      const submissionId = randomUUID();
      store.push({
        id: submissionId,
        submission_fingerprint: fingerprint,
        created_at: new Date().toISOString(),
      });

      const response: FeedbackSubmissionResponse = {
        success: true,
        status: "pending",
        submissionId,
        message: "Feedback submitted. Thanks for helping improve the app.",
      };
      return NextResponse.json(response, { status: 201 });
    }

    const recentResponse = await supabaseRestRequest({
      endpoint: "user_feedback_submissions",
      method: "GET",
      query: {
        select: "id",
        submission_fingerprint: `eq.${fingerprint}`,
        created_at: `gte.${sinceIso}`,
        limit: String(MAX_SUBMISSIONS_PER_24H),
      },
      cache: "no-store",
    });

    if (!recentResponse.ok) {
      const details = await recentResponse.text();
      return NextResponse.json(
        { error: "Could not validate feedback rate limit.", details: details.slice(0, 300) },
        { status: 500 }
      );
    }

    const recentRows = (await recentResponse.json()) as Array<{ id: string }>;
    if (recentRows.length >= MAX_SUBMISSIONS_PER_24H) {
      return NextResponse.json(
        {
          error: `Submission limit reached. You can submit up to ${MAX_SUBMISSIONS_PER_24H} feedback entries in 24 hours.`,
        },
        { status: 429 }
      );
    }

    const insertResponse = await supabaseRestRequest({
      endpoint: "user_feedback_submissions",
      method: "POST",
      prefer: "return=representation",
      body: [
        {
          category,
          message,
          contact,
          submission_fingerprint: fingerprint,
          submitted_from_ip: ip === "unknown" ? null : ip,
          user_agent: userAgent,
          status: "pending",
        },
      ],
      cache: "no-store",
    });

    if (!insertResponse.ok) {
      const details = await insertResponse.text();
      return NextResponse.json(
        { error: "Could not store feedback.", details: details.slice(0, 400) },
        { status: 500 }
      );
    }

    const inserted = (await insertResponse.json()) as Array<{ id: string }>;
    const response: FeedbackSubmissionResponse = {
      success: true,
      status: "pending",
      submissionId: inserted[0]?.id ?? randomUUID(),
      message: "Feedback submitted. Thanks for helping improve the app.",
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to submit feedback",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
