import { createIngestionDbClient } from "@/src/core/db/client";
import { sha256 } from "@/src/core/utils/hash";
import { sanitizeReviewTagArray } from "@/lib/review-attributes";
import { supabaseRpcRequest } from "@/lib/server/supabase-admin";
import {
  AdminImportPlayerCandidate,
  AdminRedditImportPreview,
  AdminRedditImportQueueItem,
  RedditImportSettings,
  RedditWatchlistItem,
  RedditWatchlistRunHistoryItem,
  RedditWatchlistRunResponse,
} from "@/types/admin-imports";

type PlayerRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  is_active?: boolean;
};

type RedditWatchlistRow = {
  id: string;
  player_id: string;
  search_terms: string[] | null;
  subreddits: string[] | null;
  is_active: boolean;
  last_polled_at: string | null;
  last_result_count: number | null;
  created_at: string;
  updated_at: string;
};

type RedditImportQueueRow = {
  id: string;
  status: "pending" | "approved" | "rejected";
  source_mode: "url" | "text";
  source_url: string | null;
  source_subreddit: string | null;
  source_author: string | null;
  source_published_at: string | null;
  source_external_id: string;
  source_post_id: string | null;
  title: string | null;
  body: string;
  player_id: string | null;
  player_name: string;
  player_ovr: number;
  event_name: string | null;
  played_position: string;
  mentioned_rank_text: string | null;
  sentiment_score: number;
  pros: string[] | null;
  cons: string[] | null;
  summary: string | null;
  confidence: number;
  needs_review: boolean;
  content_hash: string;
  raw_payload: Record<string, unknown> | null;
  review_note: string | null;
  reviewed_at: string | null;
  published_player_id: string | null;
  refreshed: boolean;
  created_at: string;
  updated_at: string;
};

type IngestRunRow = {
  id: string;
  status: "running" | "completed" | "partial" | "failed";
  subreddits: string[] | null;
  raw_comments_count: number | null;
  processed_mentions_count: number | null;
  inserted_mentions_count: number | null;
  error_count: number | null;
  error_log: string | null;
  pull_started_at: string | null;
  pull_finished_at: string | null;
  created_at: string;
};

type RedditSourcePayload = {
  sourceMode: "url" | "text";
  sourceUrl: string | null;
  sourceSubreddit: string | null;
  sourceAuthor: string | null;
  sourcePublishedAt: string | null;
  sourceExternalId: string;
  sourcePostId: string | null;
  title: string | null;
  body: string;
  rawPayload: Record<string, unknown>;
};

type ExtractedRedditDraft = {
  playerCandidate: AdminImportPlayerCandidate | null;
  extractedPlayerName: string;
  extractedPlayerOvr: number | null;
  extractedEventName: string | null;
  extractedPlayedPosition: string | null;
  extractedRankText: string | null;
  extractedSentimentScore: number | null;
  extractedPros: string[];
  extractedCons: string[];
  extractedSummary: string | null;
  confidence: number;
  needsReview: boolean;
};

type PublishRedditImportInput = {
  playerId?: string | null;
  sourceMode: "url" | "text";
  sourceUrl: string | null;
  sourceSubreddit: string | null;
  sourceAuthor: string | null;
  sourcePublishedAt: string | null;
  sourceExternalId: string;
  sourcePostId: string | null;
  title: string | null;
  body: string;
  playerName: string;
  playerOvr: number;
  eventName: string | null;
  playedPosition: string;
  mentionedRankText: string | null;
  sentimentScore: number;
  pros: string[];
  cons: string[];
  summary: string | null;
  rawPayload?: Record<string, unknown>;
};

type RunRedditWatchlistInput = {
  limitPerEntry?: number;
  mode: "admin" | "cron";
};

type RedditSearchPost = {
  id: string;
  subreddit: string;
  permalink: string;
  title: string;
  selftext: string;
  author: string | null;
  created_utc: number;
  score: number | null;
};

const MAX_PLAYER_NAME_LENGTH = 72;
const MAX_EVENT_NAME_LENGTH = 48;
const MAX_SUMMARY_LENGTH = 320;
const MAX_POSTS_PER_QUERY = 5;
const REVIEW_CUE_WORDS = [
  "review",
  "feels",
  "smooth",
  "amazing",
  "terrible",
  "good",
  "bad",
  "recommend",
  "worth",
  "pace",
  "finishing",
  "dribbling",
  "passing",
  "defending",
  "shooting",
  "physical",
  "stamina",
  "positioning",
  "weak foot",
  "skill moves",
];
const POSITIVE_CUES = [
  "great",
  "good",
  "excellent",
  "amazing",
  "smooth",
  "deadly",
  "fantastic",
  "solid",
  "op",
  "top notch",
  "recommend",
  "incredible",
  "best",
  "outstanding",
];
const NEGATIVE_CUES = [
  "bad",
  "poor",
  "terrible",
  "shite",
  "weak",
  "awful",
  "underwhelming",
  "disappoint",
  "heavy",
  "slow",
  "liability",
  "problem",
  "issue",
  "misses",
];
const POSITION_OPTIONS = [
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
] as const;
const DEFAULT_SUBREDDITS = ["FUTMobile", "EASportsFCMobile"];
const PROGRAM_FALLBACK = "Community";
const SOURCE_PLATFORM = "reddit";
const IMPORT_MODEL = "rule-based-import";
const IMPORT_MODEL_VERSION = "v1";
const PLAYER_SELECT_FIELDS = "id,player_name,base_ovr,base_position,program_promo,is_active";
const REDDIT_IMPORT_SETTINGS_KEY = "reddit_imports";
const REDDIT_FETCH_HEADERS = {
  "User-Agent": "fc-mobile-reviews/1.0",
  Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
};
const DEFAULT_REDDIT_IMPORT_SETTINGS: RedditImportSettings = {
  currentMaxBaseOvr: 117,
  maxRankOvrBoost: 5,
};

const TAG_KEYWORDS: Record<string, readonly string[]> = {
  Pace: ["pace", "quick", "fast", "acceleration", "speed", "rapid"],
  Finishing: ["finishing", "finish", "shooting", "striker", "shot", "goal"],
  Dribbling: ["dribbling", "dribble", "smooth", "agile", "agility", "joystick"],
  Positioning: ["positioning", "run", "ai", "movement", "pocket"],
  "Weak Foot": ["weak foot", "wf"],
  "Skill Moves": ["skill move", "skill moves", "elastico", "roulette", "lane change"],
  "Long Shots": ["long shot", "finesse", "curve", "outside the box"],
  Heading: ["heading", "header", "aerial"],
  Passing: ["passing", "through ball", "pass", "cross"],
  Vision: ["vision", "creative", "chance creation"],
  "Ball Control": ["ball control", "first touch", "control"],
  Stamina: ["stamina", "tired", "yellow bar"],
  "Defensive Work": ["defensive", "intercept", "track back", "defend"],
  Physical: ["physical", "strength", "strong", "tank"],
  Tackling: ["tackling", "tackle"],
  Marking: ["marking", "mark"],
  "Pace Recovery": ["track back", "recovery", "recovery pace"],
  Strength: ["strength", "strong"],
  "Aerial Duels": ["aerial", "header", "duel"],
  Aggression: ["aggression", "aggressive"],
  "Passing Out": ["passing out", "build up", "distribution"],
  "Shot Stopping": ["shot stopping", "save", "saves"],
  Reflexes: ["reflex", "reflexes"],
  Diving: ["diving", "dive"],
  Handling: ["handling", "catch"],
  "1v1 Saves": ["1v1", "one on one"],
  Distribution: ["distribution", "throw", "kicking"],
  Reactions: ["reaction", "reactions"],
};

function normalizeFreeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookupKey(value: string | null | undefined) {
  return normalizeFreeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePosition(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .trim();
  if (!cleaned) return null;
  if (POSITION_OPTIONS.includes(cleaned as (typeof POSITION_OPTIONS)[number])) {
    return cleaned;
  }
  return null;
}

function normalizeRank(value: string | null | undefined) {
  const raw = normalizeLookupKey(value);
  if (!raw) return null;
  if (["1", "base", "white"].includes(raw)) return "Base";
  if (["2", "blue"].includes(raw)) return "Blue";
  if (["3", "purple"].includes(raw)) return "Purple";
  if (["4", "red"].includes(raw)) return "Red";
  if (["5", "gold"].includes(raw)) return "Gold";
  return null;
}

function buildDefaultSearchTerms(player: PlayerRow) {
  return [
    `${player.base_ovr} ${player.player_name}`,
    `${player.player_name} ${player.base_ovr}`,
    player.player_name,
  ];
}

function limitString(value: string | null | undefined, max: number) {
  return normalizeFreeText(value).slice(0, max) || null;
}

function looksReviewLike(text: string) {
  const normalized = normalizeLookupKey(text);
  if (normalized.length < 60) return false;
  return REVIEW_CUE_WORDS.some((cue) => normalized.includes(cue));
}

function extractExplicitScore(text: string) {
  const match = text.match(/(?:^|\s)(\d{1,2}(?:\.\d)?)\s*\/\s*10(?:\b|\s)/i);
  if (!match) return null;
  const score = Number(match[1]);
  if (!Number.isFinite(score)) return null;
  if (score < 1 || score > 10) return null;
  return Number(score.toFixed(1));
}

function countCueMatches(text: string, cues: readonly string[]) {
  const normalized = normalizeLookupKey(text);
  return cues.reduce((total, cue) => total + (normalized.includes(cue) ? 1 : 0), 0);
}

function inferHeuristicScore(text: string) {
  const positive = countCueMatches(text, POSITIVE_CUES);
  const negative = countCueMatches(text, NEGATIVE_CUES);
  if (positive === 0 && negative === 0) return null;
  const raw = 6 + positive * 0.65 - negative * 0.8;
  return Math.max(1, Math.min(10, Number(raw.toFixed(1))));
}

function extractSentimentScore(text: string) {
  return extractExplicitScore(text) ?? inferHeuristicScore(text);
}

function extractRankMention(text: string) {
  const rankMatch = text.match(/\b(base|white|blue|purple|red|gold)\s+rank\b/i);
  if (rankMatch) return normalizeRank(rankMatch[1]);
  const simpleMatch = text.match(/\b(base|white|blue|purple|red|gold)\b/i);
  if (simpleMatch) return normalizeRank(simpleMatch[1]);
  const numericMatch = text.match(/\b([1-5])\s*(?:rank|tier)\b/i);
  if (numericMatch) return normalizeRank(numericMatch[1]);
  return null;
}

function extractHeaderPlayerAndOvr(text: string) {
  const normalizedText = normalizeFreeText(text);
  const headerPatterns = [
    /\b(\d{2,3})\s+([a-z][a-z .'-]{1,48})\s+review\b/i,
    /\b([a-z][a-z .'-]{1,48})\s+review\b/i,
  ];

  for (const pattern of headerPatterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;

    if (match.length >= 3) {
      const ovr = Number.parseInt(match[1], 10);
      const playerName = limitString(match[2], MAX_PLAYER_NAME_LENGTH);
      return {
        playerName,
        playerOvr: Number.isInteger(ovr) ? ovr : null,
      };
    }

    const playerName = limitString(match[1], MAX_PLAYER_NAME_LENGTH);
    return {
      playerName,
      playerOvr: null,
    };
  }

  return {
    playerName: null,
    playerOvr: null,
  };
}

function normalizeRedditImportSettings(
  value: Record<string, unknown> | null | undefined
): RedditImportSettings {
  const currentMaxBaseOvr = Number(value?.currentMaxBaseOvr);
  const maxRankOvrBoost = Number(value?.maxRankOvrBoost);

  return {
    currentMaxBaseOvr:
      Number.isInteger(currentMaxBaseOvr) && currentMaxBaseOvr >= 1 && currentMaxBaseOvr <= 130
        ? currentMaxBaseOvr
        : DEFAULT_REDDIT_IMPORT_SETTINGS.currentMaxBaseOvr,
    maxRankOvrBoost:
      Number.isInteger(maxRankOvrBoost) && maxRankOvrBoost >= 0 && maxRankOvrBoost <= 20
        ? maxRankOvrBoost
        : DEFAULT_REDDIT_IMPORT_SETTINGS.maxRankOvrBoost,
  };
}

function normalizeDisplayedOvrToBaseOvr(
  displayOvr: number | null,
  settings: RedditImportSettings
) {
  if (displayOvr === null || !Number.isInteger(displayOvr)) {
    return {
      normalizedBaseOvr: null,
      normalization: null,
    };
  }

  if (displayOvr <= settings.currentMaxBaseOvr) {
    return {
      normalizedBaseOvr: displayOvr,
      normalization: null,
    };
  }

  const normalizedBaseOvr = Math.max(1, displayOvr - settings.maxRankOvrBoost);
  return {
    normalizedBaseOvr,
    normalization: {
      displayOvr,
      normalizedBaseOvr,
      currentMaxBaseOvr: settings.currentMaxBaseOvr,
      maxRankOvrBoost: settings.maxRankOvrBoost,
    },
  };
}

function extractPlayedPosition(text: string, fallback: string | null) {
  const explicitMatch = text.match(/(?:play(?:ing)?(?:\s+him)?\s+as|used\s+him\s+as|at)\s+(ST|CF|LW|RW|LF|RF|CAM|CM|CDM|LM|RM|CB|LB|RB|LWB|RWB|GK)\b/i);
  if (explicitMatch) {
    return normalizePosition(explicitMatch[1]);
  }

  for (const position of POSITION_OPTIONS) {
    const regex = new RegExp(`\\b${position}\\b`, "i");
    if (regex.test(text)) {
      return position;
    }
  }

  return fallback;
}

function splitSentences(text: string) {
  return normalizeFreeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractTaggedSignals(text: string, position: string | null) {
  const pros = new Set<string>();
  const cons = new Set<string>();
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    const normalizedSentence = normalizeLookupKey(sentence);
    const positive = POSITIVE_CUES.some((cue) => normalizedSentence.includes(cue));
    const negative = NEGATIVE_CUES.some((cue) => normalizedSentence.includes(cue));

    for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
      if (!keywords.some((keyword) => normalizedSentence.includes(keyword))) continue;
      if (negative) {
        cons.add(tag);
      } else if (positive || pros.size === 0) {
        pros.add(tag);
      }
    }
  }

  const sanitizedPros = sanitizeReviewTagArray({
    tags: Array.from(pros),
    position,
    max: 5,
  });
  const sanitizedCons = sanitizeReviewTagArray({
    tags: Array.from(cons),
    position,
    max: 5,
  });

  return { pros: sanitizedPros, cons: sanitizedCons };
}

function buildSummary(text: string, pros: string[], cons: string[]) {
  if (pros.length > 0 && cons.length > 0) {
    return limitString(
      `Community highlights ${pros.slice(0, 2).join(" and ")} but flags ${cons[0]}.`,
      MAX_SUMMARY_LENGTH
    );
  }
  if (pros.length > 0) {
    return limitString(
      `Community highlights ${pros.slice(0, 2).join(" and ")}.`,
      MAX_SUMMARY_LENGTH
    );
  }
  if (cons.length > 0) {
    return limitString(
      `Early feedback mainly flags ${cons.slice(0, 2).join(" and ")}.`,
      MAX_SUMMARY_LENGTH
    );
  }

  const firstSentence = splitSentences(text)[0] ?? "";
  return limitString(firstSentence, MAX_SUMMARY_LENGTH);
}

function scorePlayerCandidate(args: {
  text: string;
  player: PlayerRow;
  explicitPlayerName?: string | null;
  explicitOvr?: number | null;
  explicitEventName?: string | null;
  explicitPosition?: string | null;
}) {
  const haystack = normalizeLookupKey(args.text);
  const playerName = normalizeLookupKey(args.player.player_name);
  const programPromo = normalizeLookupKey(args.player.program_promo);
  const nameTokens = playerName.split(" ").filter((token) => token.length > 2);
  const explicitName = normalizeLookupKey(args.explicitPlayerName);
  const explicitNameTokens = explicitName.split(" ").filter((token) => token.length > 1);

  let score = 0;
  if (playerName && haystack.includes(playerName)) score += 0.62;
  score += Math.min(
    0.24,
    nameTokens.filter((token) => haystack.includes(token)).length * 0.08
  );
  if (explicitName && explicitName === playerName) {
    score += 0.3;
  } else if (explicitNameTokens.length > 0) {
    const matchingExplicitTokens = explicitNameTokens.filter((token) =>
      nameTokens.includes(token)
    ).length;
    score += Math.min(0.22, matchingExplicitTokens * 0.14);
  }
  if ((args.explicitOvr ?? null) === args.player.base_ovr) score += 0.18;
  if (String(args.player.base_ovr) && haystack.includes(String(args.player.base_ovr))) {
    score += 0.12;
  }
  if (programPromo && haystack.includes(programPromo)) score += 0.08;
  if (explicitName === playerName && (args.explicitOvr ?? null) === args.player.base_ovr) {
    score += 0.3;
  }
  if (
    normalizeLookupKey(args.explicitEventName) &&
    normalizeLookupKey(args.explicitEventName) === programPromo
  ) {
    score += 0.1;
  }
  if (normalizePosition(args.explicitPosition) === normalizePosition(args.player.base_position)) {
    score += 0.05;
  }

  return Math.min(0.99, Number(score.toFixed(2)));
}

async function getActivePlayers() {
  const db = createIngestionDbClient();
  return db.select<PlayerRow[]>({
    table: "players",
    select: PLAYER_SELECT_FIELDS,
    filters: {
      is_active: "eq.true",
    },
    order: "created_at.desc",
    limit: 400,
  });
}

async function detectPlayerCandidate(args: {
  text: string;
  explicitPlayerName?: string | null;
  explicitOvr?: number | null;
  explicitEventName?: string | null;
  explicitPosition?: string | null;
}) {
  const players = await getActivePlayers();
  const ranked = players
    .map((player) => ({
      player,
      confidence: scorePlayerCandidate({
        ...args,
        player,
      }),
    }))
    .filter((entry) => entry.confidence >= 0.35)
    .sort((a, b) => b.confidence - a.confidence || a.player.player_name.localeCompare(b.player.player_name));

  const top = ranked[0];
  if (!top) return null;

  const candidate: AdminImportPlayerCandidate = {
    playerId: top.player.id,
    playerName: top.player.player_name,
    baseOvr: top.player.base_ovr,
    basePosition: top.player.base_position,
    programPromo: top.player.program_promo,
    matchConfidence: top.confidence,
  };

  return candidate;
}

function parseSubredditFromUrl(sourceUrl: string | null) {
  if (!sourceUrl) return null;
  const match = sourceUrl.match(/reddit\.com\/r\/([^/]+)/i);
  if (!match) return null;
  return match[1];
}

function isSupportedRedditHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "redd.it" || normalized === "reddit.com" || normalized.endsWith(".reddit.com");
}

function extractCanonicalRedditUrlFromHtml(html: string) {
  const canonicalMatch = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
  );
  if (canonicalMatch?.[1]) {
    return canonicalMatch[1];
  }

  const encodedUrlMatch = html.match(
    /"url":"(https?:\\\/\\\/[^"]*reddit\.com[^"]*comments[^"]*)"/i
  );
  if (!encodedUrlMatch?.[1]) {
    return null;
  }

  return encodedUrlMatch[1]
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/");
}

function buildManualSourceFromText(rawText: string, subreddit: string | null) {
  const body = normalizeFreeText(rawText);
  const externalId = `manual:${sha256(body).slice(0, 24)}`;
  return {
    sourceMode: "text" as const,
    sourceUrl: null,
    sourceSubreddit: subreddit,
    sourceAuthor: null,
    sourcePublishedAt: null,
    sourceExternalId: externalId,
    sourcePostId: null,
    title: null,
    body,
    rawPayload: {
      sourceMode: "text",
      importedAt: new Date().toISOString(),
    },
  };
}

function recursiveFindComment(children: Array<Record<string, unknown>>, targetId: string): Record<string, unknown> | null {
  for (const child of children) {
    const data = child?.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (String(data.id ?? "") === targetId) return data;
    const replies = data.replies as { data?: { children?: Array<Record<string, unknown>> } } | string | undefined;
    if (replies && typeof replies === "object") {
      const nested = recursiveFindComment(replies.data?.children ?? [], targetId);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeRedditJsonUrl(inputUrl: string) {
  const trimmed = inputUrl.trim();
  if (!trimmed) throw new Error("A Reddit URL is required.");

  const parsed = new URL(trimmed);
  if (!isSupportedRedditHostname(parsed.hostname)) {
    throw new Error("Only Reddit URLs are supported.");
  }

  if (parsed.hostname === "redd.it") {
    const postId = parsed.pathname.replace(/\/+$/, "").replace(/^\//, "");
    if (!postId) {
      throw new Error("Unsupported Reddit short URL.");
    }
    return {
      apiUrl: `https://www.reddit.com/comments/${postId}.json?raw_json=1&limit=20`,
      commentId: null,
    };
  }

  const match = parsed.pathname.match(/\/comments\/([^/]+)\/[^/]+(?:\/([^/]+))?/i);
  if (!match) {
    throw new Error("Only Reddit post or comment links are supported.");
  }

  const [pathWithoutSlash] = parsed.pathname.split("?");
  return {
    apiUrl: `https://www.reddit.com${pathWithoutSlash.replace(/\/+$/, "")}.json?raw_json=1&limit=20`,
    commentId: match[2] ?? null,
  };
}

async function resolveRedditCanonicalUrl(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: REDDIT_FETCH_HEADERS,
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`Reddit URL resolve failed (${response.status}): ${details}`);
  }

  if (response.url && response.url !== sourceUrl) {
    return response.url;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return sourceUrl;
  }

  const html = await response.text();
  return extractCanonicalRedditUrlFromHtml(html) ?? sourceUrl;
}

async function fetchRedditUrlSource(sourceUrl: string): Promise<RedditSourcePayload> {
  let normalizedUrl = sourceUrl;
  let normalized;

  try {
    normalized = normalizeRedditJsonUrl(normalizedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!message.includes("Only Reddit post or comment links are supported.")) {
      throw error;
    }

    normalizedUrl = await resolveRedditCanonicalUrl(sourceUrl);
    normalized = normalizeRedditJsonUrl(normalizedUrl);
  }

  const { apiUrl, commentId } = normalized;
  const response = await fetch(apiUrl, {
    headers: REDDIT_FETCH_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`Reddit fetch failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as Array<Record<string, unknown>>;
  const listing = payload[0]?.data as { children?: Array<Record<string, unknown>> } | undefined;
  const commentsListing = payload[1]?.data as { children?: Array<Record<string, unknown>> } | undefined;
  const post = (listing?.children?.[0]?.data ?? null) as Record<string, unknown> | null;

  if (!post) {
    throw new Error("Could not parse Reddit post payload.");
  }

  const selectedComment = commentId
    ? recursiveFindComment(commentsListing?.children ?? [], commentId)
    : null;
  const title = String(post.title ?? "").trim() || null;
  const textBody = selectedComment
    ? String(selectedComment.body ?? "")
    : `${String(post.title ?? "")}\n\n${String(post.selftext ?? "")}`.trim();
  const externalId = String(selectedComment?.id ?? post.id ?? sha256(normalizedUrl).slice(0, 12));
  const subreddit = String(post.subreddit ?? "").trim() || parseSubredditFromUrl(normalizedUrl);
  const author = String((selectedComment?.author ?? post.author ?? "") || "").trim() || null;
  const publishedAt = Number(selectedComment?.created_utc ?? post.created_utc);

  return {
    sourceMode: "url",
    sourceUrl: normalizedUrl,
    sourceSubreddit: subreddit || null,
    sourceAuthor: author,
    sourcePublishedAt: Number.isFinite(publishedAt)
      ? new Date(publishedAt * 1000).toISOString()
      : null,
    sourceExternalId: externalId,
    sourcePostId: String(post.id ?? "") || null,
    title,
    body: normalizeFreeText(textBody),
    rawPayload: {
      post,
      selectedComment,
    },
  };
}

async function buildSourcePayload(input: {
  sourceUrl?: string | null;
  rawText?: string | null;
  subreddit?: string | null;
}) {
  const sourceUrl = normalizeFreeText(input.sourceUrl);
  const rawText = normalizeFreeText(input.rawText);

  if (sourceUrl) {
    return fetchRedditUrlSource(sourceUrl);
  }
  if (rawText) {
    return buildManualSourceFromText(rawText, normalizeFreeText(input.subreddit) || null);
  }
  throw new Error("Provide either a Reddit URL or raw text.");
}

function buildImportContentHash(args: {
  sourceExternalId: string;
  body: string;
  playerName: string;
  playerOvr: number;
  eventName: string | null;
  playedPosition: string;
}) {
  return sha256(
    [
      normalizeLookupKey(args.sourceExternalId),
      normalizeLookupKey(args.body),
      normalizeLookupKey(args.playerName),
      String(args.playerOvr),
      normalizeLookupKey(args.eventName),
      normalizePosition(args.playedPosition) ?? "",
    ].join("|")
  );
}

function mapQueueItem(row: RedditImportQueueRow): AdminRedditImportQueueItem {
  return {
    id: row.id,
    status: row.status,
    sourceMode: row.source_mode,
    sourceUrl: row.source_url,
    sourceSubreddit: row.source_subreddit,
    sourceAuthor: row.source_author,
    sourcePublishedAt: row.source_published_at,
    sourceExternalId: row.source_external_id,
    title: row.title,
    body: row.body,
    playerId: row.player_id,
    playerName: row.player_name,
    playerOvr: row.player_ovr,
    eventName: row.event_name,
    playedPosition: row.played_position,
    mentionedRankText: row.mentioned_rank_text,
    sentimentScore: Number(row.sentiment_score),
    pros: Array.isArray(row.pros) ? row.pros : [],
    cons: Array.isArray(row.cons) ? row.cons : [],
    summary: row.summary,
    confidence: Number(row.confidence ?? 0),
    needsReview: row.needs_review,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    publishedPlayerId: row.published_player_id,
    refreshed: row.refreshed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRunHistoryItem(row: IngestRunRow): RedditWatchlistRunHistoryItem {
  return {
    id: row.id,
    status: row.status,
    subreddits: Array.isArray(row.subreddits) ? row.subreddits : [],
    rawCommentsCount: Number(row.raw_comments_count ?? 0),
    processedMentionsCount: Number(row.processed_mentions_count ?? 0),
    insertedMentionsCount: Number(row.inserted_mentions_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
    errorLog: row.error_log,
    pullStartedAt: row.pull_started_at,
    pullFinishedAt: row.pull_finished_at,
    createdAt: row.created_at,
  };
}

async function resolveOrCreatePlayer(input: {
  playerId?: string | null;
  playerName: string;
  playerOvr: number;
  eventName: string | null;
  playedPosition: string;
}) {
  const db = createIngestionDbClient();
  if (input.playerId) {
    const rows = await db.select<PlayerRow[]>({
      table: "players",
      select: PLAYER_SELECT_FIELDS,
      filters: {
        id: `eq.${input.playerId}`,
      },
      limit: 1,
    });
    if (rows[0]) return rows[0];
  }

  const rows = await db.select<PlayerRow[]>({
    table: "players",
    select: PLAYER_SELECT_FIELDS,
    filters: {
      player_name: `ilike.*${input.playerName.replace(/\*/g, "")}*`,
      base_ovr: `eq.${input.playerOvr}`,
      is_active: "eq.true",
    },
    order: "created_at.desc",
    limit: 30,
  });

  const targetName = normalizeLookupKey(input.playerName);
  const targetEvent = normalizeLookupKey(input.eventName);
  const exact = rows.find((row) => {
    if (normalizeLookupKey(row.player_name) !== targetName) return false;
    if (!targetEvent) return true;
    return normalizeLookupKey(row.program_promo) === targetEvent;
  });
  if (exact) return exact;

  const [created] = await db.insert<Array<PlayerRow>>("players", {
    player_name: input.playerName,
    base_ovr: input.playerOvr,
    base_position: input.playedPosition,
    program_promo: input.eventName ?? PROGRAM_FALLBACK,
    is_active: true,
  });

  return created;
}

async function findMatchingPlayer(input: {
  playerId?: string | null;
  playerName: string;
  playerOvr: number;
  eventName: string | null;
}) {
  const db = createIngestionDbClient();
  if (input.playerId) {
    const rows = await db.select<PlayerRow[]>({
      table: "players",
      select: PLAYER_SELECT_FIELDS,
      filters: {
        id: `eq.${input.playerId}`,
      },
      limit: 1,
    });
    if (rows[0]) return rows[0];
  }

  const rows = await db.select<PlayerRow[]>({
    table: "players",
    select: PLAYER_SELECT_FIELDS,
    filters: {
      player_name: `ilike.*${input.playerName.replace(/\*/g, "")}*`,
      base_ovr: `eq.${input.playerOvr}`,
      is_active: "eq.true",
    },
    order: "created_at.desc",
    limit: 30,
  });

  const targetName = normalizeLookupKey(input.playerName);
  const targetEvent = normalizeLookupKey(input.eventName);
  return (
    rows.find((row) => {
      if (normalizeLookupKey(row.player_name) !== targetName) return false;
      if (!targetEvent) return true;
      return normalizeLookupKey(row.program_promo) === targetEvent;
    }) ?? null
  );
}

function buildMentionInput(args: {
  player: PlayerRow;
  source: RedditSourcePayload;
  extracted: {
    playedPosition: string;
    mentionedRankText: string | null;
    sentimentScore: number;
    pros: string[];
    cons: string[];
    summary: string | null;
  };
  ingestRunId?: string | null;
}) {
  const sourceUrl = args.source.sourceUrl ?? `manual-import:${args.source.sourceExternalId}`;
  return {
    ingest_run_id: args.ingestRunId ?? null,
    raw_comment_id: null,
    player_id: args.player.id,
    source_platform: SOURCE_PLATFORM,
    source_subreddit: args.source.sourceSubreddit ?? "manual-import",
    source_comment_id: args.source.sourceExternalId,
    source_url: sourceUrl,
    mentioned_rank_text: args.extracted.mentionedRankText,
    mentioned_position: args.player.base_position,
    played_position: args.extracted.playedPosition,
    is_out_of_position:
      normalizePosition(args.extracted.playedPosition) !== normalizePosition(args.player.base_position),
    sentiment_score: args.extracted.sentimentScore,
    pros: args.extracted.pros,
    cons: args.extracted.cons,
    llm_summary: args.extracted.summary,
    llm_model: IMPORT_MODEL,
    llm_version: IMPORT_MODEL_VERSION,
    llm_processed_at: new Date().toISOString(),
    extraction_json: {
      sourceMode: args.source.sourceMode,
      title: args.source.title,
      author: args.source.sourceAuthor,
      sourcePublishedAt: args.source.sourcePublishedAt,
    },
    created_at: new Date().toISOString(),
  };
}

async function persistImportedMention(args: {
  player: PlayerRow;
  source: RedditSourcePayload;
  playedPosition: string;
  mentionedRankText: string | null;
  sentimentScore: number;
  pros: string[];
  cons: string[];
  summary: string | null;
  ingestRunId?: string | null;
}) {
  const db = createIngestionDbClient();
  const sourceUrl = args.source.sourceUrl ?? `manual-import:${args.source.sourceExternalId}`;

  const [rawRow] = await db.upsert<Array<{ id: string }>>({
    table: "raw_reddit_comments",
    values: {
      ingest_run_id: args.ingestRunId ?? null,
      source_platform: SOURCE_PLATFORM,
      subreddit: args.source.sourceSubreddit ?? "manual-import",
      source_post_id: args.source.sourcePostId,
      source_comment_id: args.source.sourceExternalId,
      source_url: sourceUrl,
      source_author: args.source.sourceAuthor,
      comment_body: [args.source.title, args.source.body].filter(Boolean).join("\n\n"),
      comment_score: null,
      commented_at: args.source.sourcePublishedAt,
      raw_payload: args.source.rawPayload,
    },
    onConflict: "source_platform,source_comment_id",
  });

  const mentionInput = buildMentionInput({
    player: args.player,
    source: args.source,
    extracted: {
      playedPosition: args.playedPosition,
      mentionedRankText: args.mentionedRankText,
      sentimentScore: args.sentimentScore,
      pros: args.pros,
      cons: args.cons,
      summary: args.summary,
    },
    ingestRunId: args.ingestRunId,
  });

  const [mention] = await db.upsert<Array<{ id: string }>>({
    table: "player_sentiment_mentions",
    values: {
      ...mentionInput,
      raw_comment_id: rawRow?.id ?? null,
    },
    onConflict: "source_platform,source_comment_id,player_id",
  });

  return { rawCommentId: rawRow?.id ?? null, mentionId: mention?.id ?? null };
}

async function createAdminImportRun(subreddit: string | null) {
  return createLegacyIngestRun([subreddit ?? "manual-import"]);
}

async function refreshSentimentSummary() {
  const response = await supabaseRpcRequest({
    endpoint: "refresh_player_sentiment_summary",
    body: {},
  });
  return response.ok;
}

export async function getRedditImportSettings() {
  const db = createIngestionDbClient();
  const rows = await db.select<
    Array<{
      key: string;
      value_json: Record<string, unknown> | null;
    }>
  >({
    table: "admin_runtime_settings",
    select: "key,value_json",
    filters: {
      key: `eq.${REDDIT_IMPORT_SETTINGS_KEY}`,
    },
    limit: 1,
  });

  return normalizeRedditImportSettings(rows[0]?.value_json);
}

export async function updateRedditImportSettings(input: RedditImportSettings) {
  const settings = normalizeRedditImportSettings(input as unknown as Record<string, unknown>);
  const db = createIngestionDbClient();
  await db.upsert<Array<{ key: string }>>({
    table: "admin_runtime_settings",
    values: {
      key: REDDIT_IMPORT_SETTINGS_KEY,
      value_json: settings,
    },
    onConflict: "key",
  });
  return settings;
}

export async function previewRedditImport(input: {
  sourceUrl?: string | null;
  rawText?: string | null;
  subreddit?: string | null;
  playerName?: string | null;
  playerOvr?: number | null;
  eventName?: string | null;
  playedPosition?: string | null;
}) {
  const source = await buildSourcePayload(input);
  const text = [source.title, source.body].filter(Boolean).join("\n\n");
  const settings = await getRedditImportSettings();
  const headerSignals = extractHeaderPlayerAndOvr(text);
  const explicitPlayerName =
    limitString(input.playerName, MAX_PLAYER_NAME_LENGTH) ?? headerSignals.playerName;
  const displayPlayerOvr =
    typeof input.playerOvr === "number" && Number.isInteger(input.playerOvr)
      ? input.playerOvr
      : headerSignals.playerOvr;
  const ovrNormalization = normalizeDisplayedOvrToBaseOvr(displayPlayerOvr, settings);
  const explicitPlayerOvr = ovrNormalization.normalizedBaseOvr;
  const candidate = await detectPlayerCandidate({
    text,
    explicitPlayerName,
    explicitOvr: explicitPlayerOvr,
    explicitEventName: input.eventName,
    explicitPosition: input.playedPosition,
  });

  const extractedPlayedPosition = extractPlayedPosition(text, normalizePosition(input.playedPosition) ?? candidate?.basePosition ?? null);
  const signals = extractTaggedSignals(text, extractedPlayedPosition);
  const extractedSentimentScore = extractSentimentScore(text);
  const preview: AdminRedditImportPreview = {
    sourceMode: source.sourceMode,
    sourceUrl: source.sourceUrl,
    sourceSubreddit: source.sourceSubreddit,
    sourceAuthor: source.sourceAuthor,
    sourcePublishedAt: source.sourcePublishedAt,
    sourceExternalId: source.sourceExternalId,
    title: source.title,
    body: source.body,
    playerCandidate: candidate,
    ovrNormalization: ovrNormalization.normalization,
    extractedPlayerName: explicitPlayerName ?? candidate?.playerName ?? "",
    extractedPlayerOvr:
      explicitPlayerOvr !== null && Number.isInteger(explicitPlayerOvr)
        ? explicitPlayerOvr
        : candidate?.baseOvr ?? null,
    extractedEventName: limitString(input.eventName, MAX_EVENT_NAME_LENGTH) ?? candidate?.programPromo ?? null,
    extractedPlayedPosition,
    extractedRankText: extractRankMention(text),
    extractedSentimentScore,
    extractedPros: signals.pros,
    extractedCons: signals.cons,
    extractedSummary: buildSummary(text, signals.pros, signals.cons),
    confidence: candidate?.matchConfidence ?? 0,
    needsReview:
      !candidate ||
      candidate.matchConfidence < 0.55 ||
      extractedSentimentScore === null ||
      !looksReviewLike(text),
  };

  return preview;
}

export async function queueRedditImport(
  input: PublishRedditImportInput & {
    confidence?: number;
    needsReview?: boolean;
  }
) {
  const playerName = limitString(input.playerName, MAX_PLAYER_NAME_LENGTH);
  if (!playerName || playerName.length < 2) {
    throw new Error("playerName must be at least 2 characters.");
  }
  if (!Number.isInteger(input.playerOvr) || input.playerOvr < 1 || input.playerOvr > 130) {
    throw new Error("playerOvr must be an integer between 1 and 130.");
  }

  const playedPosition = normalizePosition(input.playedPosition);
  if (!playedPosition) {
    throw new Error("playedPosition is required.");
  }

  const sentimentScore = Number(input.sentimentScore);
  if (!Number.isFinite(sentimentScore) || sentimentScore < 1 || sentimentScore > 10) {
    throw new Error("sentimentScore must be between 1 and 10.");
  }

  const matchingPlayer = await findMatchingPlayer({
    playerId: input.playerId ?? null,
    playerName,
    playerOvr: input.playerOvr,
    eventName: limitString(input.eventName, MAX_EVENT_NAME_LENGTH),
  });

  const db = createIngestionDbClient();
  const contentHash = buildImportContentHash({
    sourceExternalId: input.sourceExternalId,
    body: normalizeFreeText(input.body),
    playerName,
    playerOvr: input.playerOvr,
    eventName: limitString(input.eventName, MAX_EVENT_NAME_LENGTH),
    playedPosition,
  });

  const [row] = await db.upsert<RedditImportQueueRow[]>({
    table: "reddit_import_queue",
    values: {
      status: "pending",
      source_mode: input.sourceMode,
      source_url: input.sourceUrl ?? null,
      source_subreddit: limitString(input.sourceSubreddit, 64),
      source_author: limitString(input.sourceAuthor, 64),
      source_published_at: input.sourcePublishedAt ?? null,
      source_external_id: input.sourceExternalId,
      source_post_id: input.sourcePostId ?? null,
      title: limitString(input.title, 240),
      body: normalizeFreeText(input.body),
      player_id: matchingPlayer?.id ?? null,
      player_name: playerName,
      player_ovr: input.playerOvr,
      event_name: limitString(input.eventName, MAX_EVENT_NAME_LENGTH),
      played_position: playedPosition,
      mentioned_rank_text: normalizeRank(input.mentionedRankText),
      sentiment_score: Number(sentimentScore.toFixed(2)),
      pros: sanitizeReviewTagArray({ tags: input.pros, position: playedPosition, max: 5 }),
      cons: sanitizeReviewTagArray({ tags: input.cons, position: playedPosition, max: 5 }),
      summary: limitString(input.summary, MAX_SUMMARY_LENGTH),
      confidence: Math.max(0, Math.min(1, Number((input.confidence ?? 0).toFixed(2)))),
      needs_review: input.needsReview ?? true,
      content_hash: contentHash,
      raw_payload: input.rawPayload ?? { sourceMode: input.sourceMode },
      review_note: null,
      reviewed_at: null,
      published_player_id: null,
      refreshed: false,
    },
    onConflict: "content_hash",
  });

  return mapQueueItem(row);
}

export async function listRedditImportQueue(status: "pending" | "approved" | "rejected" = "pending") {
  const db = createIngestionDbClient();
  const rows = await db.select<RedditImportQueueRow[]>({
    table: "reddit_import_queue",
    select: [
      "id",
      "status",
      "source_mode",
      "source_url",
      "source_subreddit",
      "source_author",
      "source_published_at",
      "source_external_id",
      "source_post_id",
      "title",
      "body",
      "player_id",
      "player_name",
      "player_ovr",
      "event_name",
      "played_position",
      "mentioned_rank_text",
      "sentiment_score",
      "pros",
      "cons",
      "summary",
      "confidence",
      "needs_review",
      "content_hash",
      "raw_payload",
      "review_note",
      "reviewed_at",
      "published_player_id",
      "refreshed",
      "created_at",
      "updated_at",
    ].join(","),
    filters: {
      status: `eq.${status}`,
    },
    order: "created_at.desc",
    limit: 80,
  });

  return rows.map(mapQueueItem);
}

export async function reviewQueuedRedditImport(input: {
  id: string;
  action: "approve" | "reject";
  reviewNote?: string | null;
}) {
  const db = createIngestionDbClient();
  const rows = await db.select<RedditImportQueueRow[]>({
    table: "reddit_import_queue",
    select: [
      "id",
      "status",
      "source_mode",
      "source_url",
      "source_subreddit",
      "source_author",
      "source_published_at",
      "source_external_id",
      "source_post_id",
      "title",
      "body",
      "player_id",
      "player_name",
      "player_ovr",
      "event_name",
      "played_position",
      "mentioned_rank_text",
      "sentiment_score",
      "pros",
      "cons",
      "summary",
      "confidence",
      "needs_review",
      "content_hash",
      "raw_payload",
      "review_note",
      "reviewed_at",
      "published_player_id",
      "refreshed",
      "created_at",
      "updated_at",
    ].join(","),
    filters: {
      id: `eq.${input.id}`,
    },
    limit: 1,
  });

  const queueItem = rows[0];
  if (!queueItem) {
    throw new Error("Queued import not found.");
  }
  if (queueItem.status !== "pending") {
    throw new Error("Only pending imports can be reviewed.");
  }

  const reviewNote = limitString(input.reviewNote, 400);
  if (input.action === "reject") {
    const [updated] = await db.update<RedditImportQueueRow[]>({
      table: "reddit_import_queue",
      values: {
        status: "rejected",
        review_note: reviewNote,
        reviewed_at: new Date().toISOString(),
      },
      filters: {
        id: `eq.${input.id}`,
      },
    });
    return {
      item: mapQueueItem(updated),
      message: "Reddit import rejected.",
    };
  }

  const result = await publishRedditImport({
    playerId: queueItem.player_id,
    sourceMode: queueItem.source_mode,
    sourceUrl: queueItem.source_url,
    sourceSubreddit: queueItem.source_subreddit,
    sourceAuthor: queueItem.source_author,
    sourcePublishedAt: queueItem.source_published_at,
    sourceExternalId: queueItem.source_external_id,
    sourcePostId: queueItem.source_post_id,
    title: queueItem.title,
    body: queueItem.body,
    playerName: queueItem.player_name,
    playerOvr: queueItem.player_ovr,
    eventName: queueItem.event_name,
    playedPosition: queueItem.played_position,
    mentionedRankText: queueItem.mentioned_rank_text,
    sentimentScore: Number(queueItem.sentiment_score),
    pros: Array.isArray(queueItem.pros) ? queueItem.pros : [],
    cons: Array.isArray(queueItem.cons) ? queueItem.cons : [],
    summary: queueItem.summary,
    rawPayload: queueItem.raw_payload ?? undefined,
  });

  const [updated] = await db.update<RedditImportQueueRow[]>({
    table: "reddit_import_queue",
    values: {
      status: "approved",
      review_note: reviewNote,
      reviewed_at: new Date().toISOString(),
      published_player_id: result.playerId,
      refreshed: result.refreshed,
    },
    filters: {
      id: `eq.${input.id}`,
    },
  });

  return {
    item: mapQueueItem(updated),
    message: "Reddit import approved and published.",
  };
}

export async function publishRedditImport(input: PublishRedditImportInput) {
  const playerName = limitString(input.playerName, MAX_PLAYER_NAME_LENGTH);
  if (!playerName || playerName.length < 2) {
    throw new Error("playerName must be at least 2 characters.");
  }
  if (!Number.isInteger(input.playerOvr) || input.playerOvr < 1 || input.playerOvr > 130) {
    throw new Error("playerOvr must be an integer between 1 and 130.");
  }

  const playedPosition = normalizePosition(input.playedPosition);
  if (!playedPosition) {
    throw new Error("playedPosition is required.");
  }

  const sentimentScore = Number(input.sentimentScore);
  if (!Number.isFinite(sentimentScore) || sentimentScore < 1 || sentimentScore > 10) {
    throw new Error("sentimentScore must be between 1 and 10.");
  }

  const player = await resolveOrCreatePlayer({
    playerId: input.playerId ?? null,
    playerName,
    playerOvr: input.playerOvr,
    eventName: limitString(input.eventName, MAX_EVENT_NAME_LENGTH),
    playedPosition,
  });

  const source = {
    sourceMode: input.sourceMode,
    sourceUrl: input.sourceUrl,
    sourceSubreddit: limitString(input.sourceSubreddit, 64),
    sourceAuthor: limitString(input.sourceAuthor, 64),
    sourcePublishedAt: input.sourcePublishedAt,
    sourceExternalId: input.sourceExternalId,
    sourcePostId: input.sourcePostId,
    title: limitString(input.title, 240),
    body: normalizeFreeText(input.body),
    rawPayload: input.rawPayload ?? {
      sourceMode: input.sourceMode,
    },
  } satisfies RedditSourcePayload;

  const ingestRun = await createAdminImportRun(source.sourceSubreddit);

  try {
    await persistImportedMention({
      player,
      source,
      playedPosition,
      mentionedRankText: normalizeRank(input.mentionedRankText),
      sentimentScore: Number(sentimentScore.toFixed(2)),
      pros: sanitizeReviewTagArray({ tags: input.pros, position: playedPosition, max: 5 }),
      cons: sanitizeReviewTagArray({ tags: input.cons, position: playedPosition, max: 5 }),
      summary: limitString(input.summary, MAX_SUMMARY_LENGTH),
      ingestRunId: ingestRun.id,
    });

    await completeLegacyIngestRun({
      runId: ingestRun.id,
      status: "completed",
      rawCommentsCount: 1,
      processedMentionsCount: 1,
      insertedMentionsCount: 1,
      errorCount: 0,
      errorLog: null,
    });
  } catch (error) {
    await completeLegacyIngestRun({
      runId: ingestRun.id,
      status: "failed",
      rawCommentsCount: 0,
      processedMentionsCount: 0,
      insertedMentionsCount: 0,
      errorCount: 1,
      errorLog: error instanceof Error ? limitString(error.message, 1000) : "Unknown error",
    });
    throw error;
  }

  const refreshed = await refreshSentimentSummary();

  return {
    playerId: player.id,
    sourceExternalId: input.sourceExternalId,
    refreshed,
  };
}

function parseSearchListing(payload: Record<string, unknown>) {
  const children = ((payload.data as { children?: Array<Record<string, unknown>> } | undefined)?.children ?? []) as Array<Record<string, unknown>>;
  return children
    .map((child) => child.data as Record<string, unknown>)
    .filter(Boolean)
    .map((data): RedditSearchPost => ({
      id: String(data.id ?? ""),
      subreddit: String(data.subreddit ?? "").trim(),
      permalink: String(data.permalink ?? "").trim(),
      title: String(data.title ?? "").trim(),
      selftext: String(data.selftext ?? "").trim(),
      author: String(data.author ?? "").trim() || null,
      created_utc: Number(data.created_utc ?? 0),
      score: Number.isFinite(Number(data.score)) ? Number(data.score) : null,
    }))
    .filter((post) => post.id && (post.title || post.selftext));
}

async function fetchRedditSearch(subreddit: string, query: string, limit: number) {
  const url = new URL(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json`);
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "new");
  url.searchParams.set("t", "month");
  url.searchParams.set("limit", String(Math.max(1, Math.min(MAX_POSTS_PER_QUERY, limit))));
  url.searchParams.set("raw_json", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "fc-mobile-reviews/1.0",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`Reddit search failed (${response.status}): ${details}`);
  }

  return parseSearchListing((await response.json()) as Record<string, unknown>);
}

async function getWatchlistRows(activeOnly: boolean) {
  const db = createIngestionDbClient();
  const filters: Record<string, string> = {};
  if (activeOnly) {
    filters.is_active = "eq.true";
  }

  const rows = await db.select<RedditWatchlistRow[]>({
    table: "reddit_watchlist_entries",
    select: "id,player_id,search_terms,subreddits,is_active,last_polled_at,last_result_count,created_at,updated_at",
    filters,
    order: "updated_at.desc",
    limit: 200,
  });

  return rows;
}

async function mapWatchlistItems(rows: RedditWatchlistRow[]) {
  const db = createIngestionDbClient();
  const playerIds = [...new Set(rows.map((row) => row.player_id))];
  const players = playerIds.length
    ? await db.select<PlayerRow[]>({
        table: "players",
        select: PLAYER_SELECT_FIELDS,
        filters: {
          id: `in.(${playerIds.join(",")})`,
        },
        limit: playerIds.length,
      })
    : [];
  const playerMap = new Map(players.map((player) => [player.id, player]));

  return rows
    .map((row): RedditWatchlistItem | null => {
      const player = playerMap.get(row.player_id);
      if (!player) return null;
      return {
        id: row.id,
        playerId: player.id,
        playerName: player.player_name,
        baseOvr: player.base_ovr,
        basePosition: player.base_position,
        programPromo: player.program_promo,
        searchTerms: Array.isArray(row.search_terms) ? row.search_terms : buildDefaultSearchTerms(player),
        subreddits: Array.isArray(row.subreddits) && row.subreddits.length > 0 ? row.subreddits : [...DEFAULT_SUBREDDITS],
        isActive: row.is_active,
        lastPolledAt: row.last_polled_at,
        lastResultCount: Number(row.last_result_count ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .filter((item): item is RedditWatchlistItem => Boolean(item));
}

export async function listRedditWatchlist() {
  const rows = await getWatchlistRows(false);
  return mapWatchlistItems(rows);
}

export async function listRedditWatchlistRuns(limit = 12) {
  const db = createIngestionDbClient();
  const rows = await db.select<IngestRunRow[]>({
    table: "ingest_runs",
    select: [
      "id",
      "status",
      "subreddits",
      "raw_comments_count",
      "processed_mentions_count",
      "inserted_mentions_count",
      "error_count",
      "error_log",
      "pull_started_at",
      "pull_finished_at",
      "created_at",
    ].join(","),
    filters: {
      source_platform: `eq.${SOURCE_PLATFORM}`,
    },
    order: "pull_started_at.desc.nullslast,created_at.desc",
    limit: Math.max(1, Math.min(50, limit)),
  });

  return rows.map(mapRunHistoryItem);
}

export async function upsertRedditWatchlistEntry(input: {
  playerId: string;
  searchTerms?: string[];
  subreddits?: string[];
  isActive?: boolean;
}) {
  const db = createIngestionDbClient();
  const playerRows = await db.select<PlayerRow[]>({
    table: "players",
    select: PLAYER_SELECT_FIELDS,
    filters: {
      id: `eq.${input.playerId}`,
    },
    limit: 1,
  });
  const player = playerRows[0];
  if (!player) {
    throw new Error("Player not found.");
  }

  const normalizedSearchTerms = (input.searchTerms ?? buildDefaultSearchTerms(player))
    .map((term) => normalizeFreeText(term))
    .filter(Boolean)
    .slice(0, 8);
  const normalizedSubreddits = (input.subreddits ?? DEFAULT_SUBREDDITS)
    .map((item) => normalizeFreeText(item).replace(/^r\//i, ""))
    .filter(Boolean)
    .slice(0, 8);

  const [row] = await db.upsert<RedditWatchlistRow[]>({
    table: "reddit_watchlist_entries",
    values: {
      player_id: player.id,
      search_terms: normalizedSearchTerms,
      subreddits: normalizedSubreddits.length > 0 ? normalizedSubreddits : DEFAULT_SUBREDDITS,
      is_active: input.isActive ?? true,
    },
    onConflict: "player_id",
  });

  const [item] = await mapWatchlistItems([row]);
  return item;
}

export async function updateRedditWatchlistEntry(input: {
  id: string;
  searchTerms?: string[];
  subreddits?: string[];
  isActive?: boolean;
}) {
  const db = createIngestionDbClient();
  const existingRows = await db.select<RedditWatchlistRow[]>({
    table: "reddit_watchlist_entries",
    select: "id,player_id,search_terms,subreddits,is_active,last_polled_at,last_result_count,created_at,updated_at",
    filters: {
      id: `eq.${input.id}`,
    },
    limit: 1,
  });
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Watchlist entry not found.");
  }

  const searchTerms = input.searchTerms
    ? input.searchTerms.map((term) => normalizeFreeText(term)).filter(Boolean).slice(0, 8)
    : Array.isArray(existing.search_terms)
      ? existing.search_terms
      : [];
  const subreddits = input.subreddits
    ? input.subreddits
        .map((item) => normalizeFreeText(item).replace(/^r\//i, ""))
        .filter(Boolean)
        .slice(0, 8)
    : Array.isArray(existing.subreddits)
      ? existing.subreddits
      : DEFAULT_SUBREDDITS;

  const updatedRows = await db.update<RedditWatchlistRow[]>({
    table: "reddit_watchlist_entries",
    values: {
      search_terms: searchTerms,
      subreddits: subreddits.length > 0 ? subreddits : DEFAULT_SUBREDDITS,
      is_active: typeof input.isActive === "boolean" ? input.isActive : existing.is_active,
    },
    filters: {
      id: `eq.${input.id}`,
    },
  });

  const [item] = await mapWatchlistItems(updatedRows);
  return item;
}

export async function deleteRedditWatchlistEntry(id: string) {
  const db = createIngestionDbClient();
  await db.update({
    table: "reddit_watchlist_entries",
    values: {
      is_active: false,
    },
    filters: {
      id: `eq.${id}`,
    },
  });
}

async function createLegacyIngestRun(subreddits: string[]) {
  const db = createIngestionDbClient();
  const [row] = await db.insert<Array<{ id: string }>>("ingest_runs", {
    source_platform: SOURCE_PLATFORM,
    subreddits,
    status: "running",
    pull_started_at: new Date().toISOString(),
    raw_comments_count: 0,
    processed_mentions_count: 0,
    inserted_mentions_count: 0,
    error_count: 0,
  });
  return row;
}

async function completeLegacyIngestRun(args: {
  runId: string;
  status: "completed" | "partial" | "failed";
  rawCommentsCount: number;
  processedMentionsCount: number;
  insertedMentionsCount: number;
  errorCount: number;
  errorLog: string | null;
}) {
  const db = createIngestionDbClient();
  await db.update({
    table: "ingest_runs",
    values: {
      status: args.status,
      pull_finished_at: new Date().toISOString(),
      raw_comments_count: args.rawCommentsCount,
      processed_mentions_count: args.processedMentionsCount,
      inserted_mentions_count: args.insertedMentionsCount,
      error_count: args.errorCount,
      error_log: args.errorLog,
    },
    filters: {
      id: `eq.${args.runId}`,
    },
  });
}

export async function runRedditWatchlistSync(input: RunRedditWatchlistInput): Promise<RedditWatchlistRunResponse> {
  const items = await listRedditWatchlist();
  const activeItems = items.filter((item) => item.isActive);
  const run = await createLegacyIngestRun(
    [...new Set(activeItems.flatMap((item) => item.subreddits))].filter(Boolean)
  );

  let discoveredPosts = 0;
  let importedMentions = 0;
  let failedEntries = 0;
  const errors: string[] = [];
  const seenExternalIds = new Set<string>();

  for (const item of activeItems) {
    try {
      const player = {
        id: item.playerId,
        player_name: item.playerName,
        base_ovr: item.baseOvr,
        base_position: item.basePosition,
        program_promo: item.programPromo,
      } satisfies PlayerRow;
      let entryImported = 0;

      for (const subreddit of item.subreddits) {
        for (const searchTerm of item.searchTerms.slice(0, 4)) {
          const posts = await fetchRedditSearch(subreddit, searchTerm, input.limitPerEntry ?? MAX_POSTS_PER_QUERY);
          for (const post of posts) {
            const externalId = `post:${post.id}`;
            if (seenExternalIds.has(`${item.playerId}:${externalId}`)) continue;
            seenExternalIds.add(`${item.playerId}:${externalId}`);
            discoveredPosts += 1;

            const body = [post.title, post.selftext].filter(Boolean).join("\n\n");
            if (!looksReviewLike(body)) continue;

            const playedPosition = extractPlayedPosition(body, player.base_position) ?? player.base_position;
            const sentimentScore = extractSentimentScore(body);
            if (sentimentScore === null) continue;
            const signals = extractTaggedSignals(body, playedPosition);
            const summary = buildSummary(body, signals.pros, signals.cons);

            await persistImportedMention({
              player,
              source: {
                sourceMode: "url",
                sourceUrl: `https://www.reddit.com${post.permalink}`,
                sourceSubreddit: post.subreddit || subreddit,
                sourceAuthor: post.author,
                sourcePublishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
                sourceExternalId: externalId,
                sourcePostId: post.id,
                title: post.title,
                body: normalizeFreeText(body),
                rawPayload: { post },
              },
              playedPosition,
              mentionedRankText: extractRankMention(body),
              sentimentScore,
              pros: signals.pros,
              cons: signals.cons,
              summary,
              ingestRunId: run.id,
            });
            importedMentions += 1;
            entryImported += 1;
          }
        }
      }

      const db = createIngestionDbClient();
      await db.update({
        table: "reddit_watchlist_entries",
        values: {
          last_polled_at: new Date().toISOString(),
          last_result_count: entryImported,
        },
        filters: {
          id: `eq.${item.id}`,
        },
      });
    } catch (error) {
      failedEntries += 1;
      errors.push(
        `${item.playerName} ${item.baseOvr}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  const refreshed = importedMentions > 0 ? await refreshSentimentSummary() : false;
  await completeLegacyIngestRun({
    runId: run.id,
    status: failedEntries > 0 ? (importedMentions > 0 ? "partial" : "failed") : "completed",
    rawCommentsCount: discoveredPosts,
    processedMentionsCount: discoveredPosts,
    insertedMentionsCount: importedMentions,
    errorCount: failedEntries,
    errorLog: errors.length > 0 ? errors.join("\n") : null,
  });

  return {
    success: true,
    processedEntries: activeItems.length,
    discoveredPosts,
    importedMentions,
    failedEntries,
    refreshed,
    mode: input.mode,
  };
}
