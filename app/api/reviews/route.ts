import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  LOCAL_MOCK_PLAYERS,
  LOCAL_MOCK_REVIEW_SEEDS,
  shouldUseLocalMockData,
} from "@/lib/local-mock-data";
import { sanitizeReviewTagArray } from "@/lib/review-attributes";
import { trackAppEvent } from "@/lib/server/analytics";
import {
  ReviewSubmissionRequest,
  ReviewSubmissionResponse,
  SubmittedUsernameType,
} from "@/types/review";

const MAX_NOTE_LENGTH = 220;
const MAX_PROS = 3;
const MAX_CONS = 2;
const MAX_SUBMISSIONS_PER_24H = 5;
const MAX_USERNAME_LENGTH = 32;
const DUPLICATE_LOOKBACK_HOURS = 72;
const MAX_PLAYER_NAME_LENGTH = 72;
const MAX_EVENT_NAME_LENGTH = 48;
const MIN_OVR = 1;
const MAX_OVR = 130;
const FALLBACK_PROGRAM_PROMO = "Community";
const CAPTCHA_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type LocalSubmission = {
  id: string;
  player_id: string;
  player_key: string;
  submission_fingerprint: string;
  submitted_at: string;
  status: "pending" | "approved";
  note: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __fcmLocalReviewSubmissions: LocalSubmission[] | undefined;
}

const COMMON_POSITIONS = new Set([
  "ST",
  "CF",
  "LW",
  "RW",
  "LF",
  "RF",
  "CAM",
  "CM",
  "CDM",
  "LM",
  "RM",
  "CB",
  "LB",
  "RB",
  "LWB",
  "RWB",
  "GK",
]);

function normalizePosition(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length < 2 || cleaned.length > 4) return null;
  return cleaned;
}

function normalizeRank(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["1", "base", "white"].includes(raw)) return "Base";
  if (["2", "blue"].includes(raw)) return "Blue";
  if (["3", "purple"].includes(raw)) return "Purple";
  if (["4", "red"].includes(raw)) return "Red";
  if (["5", "gold"].includes(raw)) return "Gold";
  return null;
}

function normalizeUsername(value: string | null | undefined) {
  const trimmed = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) return null;
  return trimmed.slice(0, MAX_USERNAME_LENGTH);
}

function normalizeFreeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookupKey(value: string | null | undefined) {
  return normalizeFreeText(value).toLowerCase();
}

function normalizeUsernameType(
  value: string | null | undefined
): SubmittedUsernameType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "reddit" || normalized === "game") {
    return normalized;
  }
  return null;
}

function isValidSubmittedUsername(
  username: string,
  usernameType: SubmittedUsernameType
) {
  if (usernameType === "reddit") {
    return /^[A-Za-z0-9_-]{3,30}$/.test(username);
  }

  return /^(?=.{2,32}$)[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(username);
}

function normalizeNoteForDuplicate(value: string | null | undefined) {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text;
}

function noteTokenSimilarity(a: string, b: string) {
  const tokensA = new Set(a.split(" ").filter((token) => token.length > 2));
  const tokensB = new Set(b.split(" ").filter((token) => token.length > 2));
  if (!tokensA.size || !tokensB.size) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }

  const minSize = Math.min(tokensA.size, tokensB.size);
  return minSize === 0 ? 0 : overlap / minSize;
}

function isNearDuplicateNote(candidate: string | null, existing: string | null) {
  const normalizedCandidate = normalizeNoteForDuplicate(candidate);
  const normalizedExisting = normalizeNoteForDuplicate(existing);
  if (!normalizedCandidate || !normalizedExisting) return false;

  if (normalizedCandidate === normalizedExisting) return true;
  if (
    normalizedCandidate.length >= 40 &&
    (normalizedCandidate.includes(normalizedExisting) ||
      normalizedExisting.includes(normalizedCandidate))
  ) {
    return true;
  }

  return noteTokenSimilarity(normalizedCandidate, normalizedExisting) >= 0.82;
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

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return { supabaseUrl, supabaseKey };
}

async function supabaseRest(
  endpoint: string,
  init: {
    method?: "GET" | "POST";
    query?: Record<string, string>;
    body?: unknown;
  }
) {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/${endpoint}`);

  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  return fetch(url, {
    method: init.method ?? "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer:
        init.method === "POST"
          ? "return=representation"
          : "return=minimal",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
}

async function supabaseRpc(
  endpoint: string,
  body: Record<string, unknown>
): Promise<Response> {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  return fetch(`${supabaseUrl}/rest/v1/rpc/${endpoint}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function getClientIdentity(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.REVIEW_FINGERPRINT_SALT ?? "fcm-reviews";
  const fingerprint = createHash("sha256")
    .update(`${ip}|${userAgent}|${salt}`)
    .digest("hex");
  return { ip, userAgent, fingerprint };
}

function getLocalSubmissionStore(): LocalSubmission[] {
  if (globalThis.__fcmLocalReviewSubmissions) {
    return globalThis.__fcmLocalReviewSubmissions;
  }

  globalThis.__fcmLocalReviewSubmissions = LOCAL_MOCK_REVIEW_SEEDS.map((seed) => ({
    id: seed.id,
    player_id: seed.player_id,
    player_key: `id:${seed.player_id}`,
    submission_fingerprint: "seed",
    submitted_at: seed.submitted_at,
    status: seed.status,
    note: seed.note ?? null,
  }));

  return globalThis.__fcmLocalReviewSubmissions;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ReviewSubmissionRequest;
    const honeypot = String(payload.honeypot ?? "").trim();
    if (honeypot) {
      const decoyResponse: ReviewSubmissionResponse = {
        success: true,
        status: "pending",
        submissionId: randomUUID(),
        refreshed: false,
        message: "Review submitted and pending moderation.",
      };
      return NextResponse.json(decoyResponse, { status: 201 });
    }

    const captchaToken = String(payload.captchaToken ?? "").trim();

    const playerName = normalizeFreeText(payload.playerName).slice(
      0,
      MAX_PLAYER_NAME_LENGTH
    );
    if (playerName.length < 2) {
      return NextResponse.json(
        { error: "playerName must be at least 2 characters" },
        { status: 400 }
      );
    }

    const playerOvr = Number(payload.playerOvr);
    if (
      !Number.isInteger(playerOvr) ||
      playerOvr < MIN_OVR ||
      playerOvr > MAX_OVR
    ) {
      return NextResponse.json(
        { error: `playerOvr must be an integer between ${MIN_OVR} and ${MAX_OVR}` },
        { status: 400 }
      );
    }

    const eventName =
      normalizeFreeText(payload.eventName).slice(0, MAX_EVENT_NAME_LENGTH) || null;
    const playerNameLookupKey = normalizeLookupKey(playerName);
    const eventNameLookupKey = eventName ? normalizeLookupKey(eventName) : null;

    const sentimentScore = Number(payload.sentimentScore);
    if (
      !Number.isFinite(sentimentScore) ||
      sentimentScore < 1 ||
      sentimentScore > 10
    ) {
      return NextResponse.json(
        { error: "sentimentScore must be between 1 and 10" },
        { status: 400 }
      );
    }

    const playedPosition = normalizePosition(payload.playedPosition);
    if (!playedPosition || !COMMON_POSITIONS.has(playedPosition)) {
      return NextResponse.json(
        { error: "Invalid playedPosition" },
        { status: 400 }
      );
    }

    const mentionedRankText = normalizeRank(payload.mentionedRankText);
    const pros = sanitizeReviewTagArray({
      tags: payload.pros,
      position: playedPosition,
      max: MAX_PROS,
    });
    const cons = sanitizeReviewTagArray({
      tags: payload.cons,
      position: playedPosition,
      max: MAX_CONS,
    });
    const note = String(payload.note ?? "").trim().slice(0, MAX_NOTE_LENGTH) || null;

    const submittedUsername = normalizeUsername(payload.submittedUsername);
    const submittedUsernameType = normalizeUsernameType(
      payload.submittedUsernameType
    );

    if (submittedUsername && !submittedUsernameType) {
      return NextResponse.json(
        {
          error:
            "submittedUsernameType is required when a username is provided.",
        },
        { status: 400 }
      );
    }

    if (!submittedUsername && submittedUsernameType) {
      return NextResponse.json(
        {
          error:
            "submittedUsername is required when submittedUsernameType is provided.",
        },
        { status: 400 }
      );
    }

    if (
      submittedUsername &&
      submittedUsernameType &&
      !isValidSubmittedUsername(submittedUsername, submittedUsernameType)
    ) {
      return NextResponse.json(
        {
          error:
            submittedUsernameType === "reddit"
              ? "Invalid Reddit username format"
              : "Invalid in-game username format",
        },
        { status: 400 }
      );
    }

    const { ip, userAgent, fingerprint } = getClientIdentity(request);
    const throttleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const duplicateCutoff = new Date(
      Date.now() - DUPLICATE_LOOKBACK_HOURS * 60 * 60 * 1000
    ).toISOString();
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);
    const autoApprove =
      String(process.env.REVIEW_AUTO_APPROVE ?? "false").toLowerCase() === "true";
    const status: "approved" | "pending" = autoApprove ? "approved" : "pending";

    if (!captchaToken && isCaptchaRequired()) {
      return NextResponse.json(
        { error: "Captcha verification is required." },
        { status: 400 }
      );
    }

    if (captchaToken || isCaptchaRequired()) {
      const captchaCheck = await verifyTurnstileToken({ token: captchaToken, ip });
      if (!captchaCheck.ok) {
        const generic =
          captchaCheck.reason === "Captcha is not configured"
            ? "Captcha is not configured on server."
            : "Captcha verification failed.";
        return NextResponse.json({ error: generic }, { status: 400 });
      }
    }

    if (useLocalMockData) {
      const store = getLocalSubmissionStore();
      const recentCount = store.filter(
        (row) =>
          row.submission_fingerprint === fingerprint &&
          row.submitted_at >= throttleCutoff
      ).length;

      if (recentCount >= MAX_SUBMISSIONS_PER_24H) {
        return NextResponse.json(
          {
            error: `Submission limit reached. You can submit up to ${MAX_SUBMISSIONS_PER_24H} reviews in 24 hours.`,
          },
          { status: 429 }
        );
      }

      const localPlayer = LOCAL_MOCK_PLAYERS.find(
        (player) =>
          normalizeLookupKey(player.player_name) === playerNameLookupKey &&
          player.base_ovr === playerOvr &&
          (!eventNameLookupKey ||
            normalizeLookupKey(player.program_promo) === eventNameLookupKey)
      );
      const localPlayerKey =
        localPlayer?.player_id ??
        `${playerNameLookupKey}|${playerOvr}|${eventNameLookupKey ?? ""}`;
      const localPlayerId =
        localPlayer?.player_id ??
        `local-${createHash("sha256").update(localPlayerKey).digest("hex").slice(0, 16)}`;

      const recentPlayerNotes = store.filter(
        (row) =>
          row.player_key === localPlayerKey && row.submitted_at >= duplicateCutoff
      );
      const hasNearDuplicate = recentPlayerNotes.some((row) =>
        isNearDuplicateNote(note, row.note)
      );
      if (hasNearDuplicate) {
        return NextResponse.json(
          {
            error:
              "This review looks too similar to a recent submission for the same player. Please add unique context.",
          },
          { status: 409 }
        );
      }

      const submissionId = randomUUID();
      store.push({
        id: submissionId,
        player_id: localPlayerId,
        player_key: localPlayerKey,
        submission_fingerprint: fingerprint,
        submitted_at: new Date().toISOString(),
        status,
        note,
      });

      const response: ReviewSubmissionResponse = {
        success: true,
        status,
        submissionId,
        refreshed: false,
        message:
          status === "approved"
            ? "Review submitted successfully."
            : "Review submitted and pending moderation.",
      };

      await trackAppEvent({
        eventType: "review_submitted",
        playerId: localPlayerId,
        metadata: { source: "local-mock", status },
        request,
      });

      return NextResponse.json(response, { status: 201 });
    }

    const existingResponse = await supabaseRest("user_review_submissions", {
      method: "GET",
      query: {
        select: "id",
        submission_fingerprint: `eq.${fingerprint}`,
        submitted_at: `gte.${throttleCutoff}`,
        order: "submitted_at.desc",
        limit: String(MAX_SUBMISSIONS_PER_24H),
      },
    });

    if (!existingResponse.ok) {
      const details = await existingResponse.text();
      return NextResponse.json(
        { error: "Throttle check failed", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const existingRows = (await existingResponse.json()) as Array<{ id: string }>;
    if (existingRows.length >= MAX_SUBMISSIONS_PER_24H) {
      return NextResponse.json(
        {
          error: `Submission limit reached. You can submit up to ${MAX_SUBMISSIONS_PER_24H} reviews in 24 hours.`,
        },
        { status: 429 }
      );
    }

    const playerResponse = await supabaseRest("players", {
      method: "GET",
      query: {
        select: "id,player_name,base_ovr,program_promo",
        player_name: `ilike.${playerName}`,
        base_ovr: `eq.${playerOvr}`,
        is_active: "eq.true",
        order: "created_at.desc",
        limit: "30",
      },
    });

    if (!playerResponse.ok) {
      const details = await playerResponse.text();
      return NextResponse.json(
        { error: "Player lookup failed", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const candidatePlayers = (await playerResponse.json()) as Array<{
      id: string;
      player_name: string;
      base_ovr: number;
      program_promo: string;
    }>;

    const exactNameMatches = candidatePlayers.filter(
      (row) =>
        normalizeLookupKey(row.player_name) === playerNameLookupKey &&
        row.base_ovr === playerOvr
    );

    let resolvedPlayerId =
      (eventNameLookupKey
        ? exactNameMatches.find(
            (row) => normalizeLookupKey(row.program_promo) === eventNameLookupKey
          )
        : exactNameMatches[0])?.id ?? null;

    if (!resolvedPlayerId) {
      const createPlayerResponse = await supabaseRest("players", {
        method: "POST",
        body: [
          {
            player_name: playerName,
            base_ovr: playerOvr,
            base_position: playedPosition,
            program_promo: eventName ?? FALLBACK_PROGRAM_PROMO,
            is_active: true,
          },
        ],
      });

      if (!createPlayerResponse.ok) {
        const details = await createPlayerResponse.text();
        return NextResponse.json(
          { error: "Failed to create player", details: details.slice(0, 500) },
          { status: 500 }
        );
      }

      const created = (await createPlayerResponse.json()) as Array<{ id: string }>;
      resolvedPlayerId = created[0]?.id ?? null;
    }

    if (!resolvedPlayerId) {
      return NextResponse.json(
        { error: "Unable to resolve player for this review." },
        { status: 500 }
      );
    }

    const duplicateResponse = await supabaseRest("user_review_submissions", {
      method: "GET",
      query: {
        select: "note",
        player_id: `eq.${resolvedPlayerId}`,
        submitted_at: `gte.${duplicateCutoff}`,
        note: "not.is.null",
        order: "submitted_at.desc",
        limit: "40",
      },
    });

    if (!duplicateResponse.ok) {
      const details = await duplicateResponse.text();
      return NextResponse.json(
        { error: "Duplicate check failed", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const recentNotes = (await duplicateResponse.json()) as Array<{ note: string | null }>;
    const hasNearDuplicate = recentNotes.some((row) =>
      isNearDuplicateNote(note, row.note)
    );
    if (hasNearDuplicate) {
      return NextResponse.json(
        {
          error:
            "This review looks too similar to a recent submission for the same player. Please add unique context.",
        },
        { status: 409 }
      );
    }

    const insertResponse = await supabaseRest("user_review_submissions", {
      method: "POST",
      body: [
        {
          player_id: resolvedPlayerId,
          source_platform: "user",
          submission_fingerprint: fingerprint,
          submitted_from_ip: ip === "unknown" ? null : ip,
          user_agent: userAgent.slice(0, 350),
          submitted_username: submittedUsername,
          submitted_username_type: submittedUsernameType,
          sentiment_score: Number(sentimentScore.toFixed(2)),
          played_position: playedPosition,
          mentioned_rank_text: mentionedRankText,
          pros,
          cons,
          note,
          status,
        },
      ],
    });

    if (!insertResponse.ok) {
      const details = await insertResponse.text();
      const lowered = details.toLowerCase();
      if (
        lowered.includes("submission limit reached") ||
        lowered.includes("max 5 reviews")
      ) {
        return NextResponse.json(
          {
            error: `Submission limit reached. You can submit up to ${MAX_SUBMISSIONS_PER_24H} reviews in 24 hours.`,
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: "Failed to store review", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const inserted = (await insertResponse.json()) as Array<{
      id: string;
      status: "approved" | "pending";
    }>;
    const saved = inserted[0];

    let refreshed = false;
    if (saved?.status === "approved") {
      const refreshResponse = await supabaseRpc("refresh_player_sentiment_summary", {});
      refreshed = refreshResponse.ok;
    }

    const resolvedStatus = saved?.status ?? status;
    const response: ReviewSubmissionResponse = {
      success: true,
      status: resolvedStatus,
      submissionId: saved?.id ?? "",
      refreshed,
      message:
        resolvedStatus === "approved"
          ? "Review submitted successfully."
          : "Review submitted and pending moderation.",
    };

    await trackAppEvent({
      eventType: "review_submitted",
      playerId: resolvedPlayerId,
      metadata: { source: "supabase", status: resolvedStatus, refreshed },
      request,
    });

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid request payload",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
