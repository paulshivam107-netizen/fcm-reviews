#!/usr/bin/env node

/**
 * FC Mobile Opinion Tracker
 * Reddit -> LLM -> Supabase middleman pipeline
 *
 * - Pulls latest comments from configured subreddits.
 * - Uses OpenAI or Gemini to extract per-player sentiment mentions.
 * - Upserts normalized rows into Supabase tables.
 * - Refreshes materialized summary view for fast frontend reads.
 *
 * Runtime: Node 20+ (uses native fetch).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const PIPELINE_NAME = 'reddit-batch-pipeline';

function log(message, extra = null) {
  const prefix = `[${PIPELINE_NAME}]`;
  if (extra === null) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, extra);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function roundUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

function currentUtcMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}

function parseCsv(value, fallback = '') {
  return String(value ?? fallback)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePosition(value) {
  const cleaned = normalizeText(value).toUpperCase().replace(/[^A-Z]/g, '');
  return cleaned || null;
}

function clampScore(value, min = 1, max = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function extractFirstJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // continue with fallback extraction
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return null;

  const candidate = raw.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function toIsoFromUnix(seconds) {
  if (!Number.isFinite(seconds)) return null;
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

function sanitizeTermArray(values, maxItems = 8) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const item of values) {
    const cleaned = normalizeText(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned.slice(0, 120));
    if (out.length >= maxItems) break;
  }
  return out;
}

function playerIdentityKey({ player_name, base_ovr, base_position, program_promo }) {
  return [
    normalizeKey(player_name),
    Number(base_ovr),
    normalizeKey(base_position),
    normalizeKey(program_promo),
  ].join('|');
}

function makeConfig() {
  return {
    supabaseUrl: requiredEnv('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseServiceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),

    redditSubreddits: parseCsv(process.env.REDDIT_SUBREDDITS, 'FUTMobile,easportsfcmobile'),
    redditLimitPerSubreddit: parseIntEnv(process.env.REDDIT_LIMIT_PER_SUBREDDIT, 75),
    redditUserAgent:
      process.env.REDDIT_USER_AGENT ??
      'fc-mobile-opinion-tracker/0.1 (contact: admin@example.com)',

    redditClientId: process.env.REDDIT_CLIENT_ID ?? '',
    redditClientSecret: process.env.REDDIT_CLIENT_SECRET ?? '',

    llmProvider: normalizeKey(process.env.LLM_PROVIDER ?? 'openai'),
    openAiApiKey: process.env.OPENAI_API_KEY ?? '',
    openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',

    cardCatalogFile: process.env.CARD_CATALOG_FILE ?? '',
    minCommentLength: parseIntEnv(process.env.MIN_COMMENT_LENGTH, 20),
    maxCommentsPerRun: parseIntEnv(process.env.MAX_COMMENTS_PER_RUN, 200),
    maxLlmCallsPerRun: parseIntEnv(process.env.MAX_LLM_CALLS_PER_RUN, 180),
    llmSleepMs: parseIntEnv(process.env.LLM_SLEEP_MS, 250),
    llmTemperature: parseFloatEnv(process.env.LLM_TEMPERATURE, 0.15),
    llmEstimatedInputTokensPerCall: parseIntEnv(process.env.LLM_EST_INPUT_TOKENS_PER_CALL, 900),
    llmEstimatedOutputTokensPerCall: parseIntEnv(process.env.LLM_EST_OUTPUT_TOKENS_PER_CALL, 220),

    requireBudgetGuards: parseBool(process.env.REQUIRE_BUDGET_GUARDS, true),

    openAiInputCostPer1k: parseFloatEnv(process.env.OPENAI_INPUT_COST_PER_1K, 0.00015),
    openAiOutputCostPer1k: parseFloatEnv(process.env.OPENAI_OUTPUT_COST_PER_1K, 0.0006),
    openAiRequestCostUsd: parseFloatEnv(process.env.OPENAI_REQUEST_COST_USD, 0),

    geminiInputCostPer1k: parseFloatEnv(process.env.GEMINI_INPUT_COST_PER_1K, 0.00015),
    geminiOutputCostPer1k: parseFloatEnv(process.env.GEMINI_OUTPUT_COST_PER_1K, 0.0006),
    geminiRequestCostUsd: parseFloatEnv(process.env.GEMINI_REQUEST_COST_USD, 0),

    redditRequestCostUsd: parseFloatEnv(process.env.REDDIT_REQUEST_COST_USD, 0.00024),

    dryRun: parseBool(process.env.DRY_RUN, false),
    verbose: parseBool(process.env.VERBOSE, true),
  };
}

async function supabaseRequest(config, endpoint, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${endpoint}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Supabase ${method} ${endpoint} failed (${response.status}): ${errText.slice(0, 1000)}`
    );
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

function llmProviderScope(provider) {
  return provider === 'gemini' ? 'gemini' : 'openai';
}

function providerRateFallback(config, scope) {
  if (scope === 'openai') {
    return {
      input_cost_per_1k: config.openAiInputCostPer1k,
      output_cost_per_1k: config.openAiOutputCostPer1k,
      request_cost_usd: config.openAiRequestCostUsd,
    };
  }

  if (scope === 'gemini') {
    return {
      input_cost_per_1k: config.geminiInputCostPer1k,
      output_cost_per_1k: config.geminiOutputCostPer1k,
      request_cost_usd: config.geminiRequestCostUsd,
    };
  }

  if (scope === 'reddit_api') {
    return {
      input_cost_per_1k: 0,
      output_cost_per_1k: 0,
      request_cost_usd: config.redditRequestCostUsd,
    };
  }

  return {
    input_cost_per_1k: 0,
    output_cost_per_1k: 0,
    request_cost_usd: 0,
  };
}

async function fetchBudgetLimits(config) {
  const rows = await supabaseRequest(config, 'pipeline_budget_limits', {
    method: 'GET',
    query: {
      select:
        'scope,monthly_cap_usd,input_cost_per_1k,output_cost_per_1k,request_cost_usd,is_active,notes',
      is_active: 'eq.true',
      limit: 20,
    },
  });

  const limits = new Map();
  for (const row of rows ?? []) {
    limits.set(row.scope, {
      scope: row.scope,
      monthly_cap_usd: toNonNegativeNumber(row.monthly_cap_usd, 0),
      input_cost_per_1k: toNonNegativeNumber(row.input_cost_per_1k, 0),
      output_cost_per_1k: toNonNegativeNumber(row.output_cost_per_1k, 0),
      request_cost_usd: toNonNegativeNumber(row.request_cost_usd, 0),
      is_active: Boolean(row.is_active),
      notes: row.notes ?? null,
    });
  }
  return limits;
}

async function fetchMonthlySpendByScope(config, monthStartIso) {
  const rows = await supabaseRequest(config, 'rpc/get_pipeline_monthly_spend', {
    method: 'POST',
    body: { month_start: monthStartIso },
  });

  const spend = new Map();
  for (const row of rows ?? []) {
    if (!row?.scope) continue;
    spend.set(row.scope, toNonNegativeNumber(row.total_cost_usd, 0));
  }
  return spend;
}

async function initializeBudgetState(config) {
  const monthStartIso = currentUtcMonthStartIso();
  try {
    const limits = await fetchBudgetLimits(config);
    const spend = await fetchMonthlySpendByScope(config, monthStartIso);
    return {
      enabled: limits.size > 0,
      monthStartIso,
      limits,
      spend,
    };
  } catch (err) {
    if (config.requireBudgetGuards) {
      throw new Error(`Budget guards required but unavailable: ${err.message}`);
    }
    log(`Budget guards unavailable, continuing without enforcement: ${err.message}`);
    return {
      enabled: false,
      monthStartIso,
      limits: new Map(),
      spend: new Map(),
    };
  }
}

function getScopeRates(config, budgetState, scope) {
  const fallback = providerRateFallback(config, scope);
  const tableRow = budgetState?.limits?.get(scope);
  if (!tableRow) return fallback;
  return {
    input_cost_per_1k: toNonNegativeNumber(tableRow.input_cost_per_1k, fallback.input_cost_per_1k),
    output_cost_per_1k: toNonNegativeNumber(
      tableRow.output_cost_per_1k,
      fallback.output_cost_per_1k
    ),
    request_cost_usd: toNonNegativeNumber(tableRow.request_cost_usd, fallback.request_cost_usd),
  };
}

function calculateLlmCostUsd(config, budgetState, provider, inputTokens, outputTokens) {
  const scope = llmProviderScope(provider);
  const rates = getScopeRates(config, budgetState, scope);
  const inTokens = Math.max(0, Number(inputTokens) || 0);
  const outTokens = Math.max(0, Number(outputTokens) || 0);
  const total =
    rates.request_cost_usd +
    (inTokens / 1000) * rates.input_cost_per_1k +
    (outTokens / 1000) * rates.output_cost_per_1k;
  return roundUsd(total);
}

function estimateLlmCostUsd(config, budgetState, provider) {
  return calculateLlmCostUsd(
    config,
    budgetState,
    provider,
    config.llmEstimatedInputTokensPerCall,
    config.llmEstimatedOutputTokensPerCall
  );
}

function estimateRedditRequestCostUsd(config, budgetState) {
  const rates = getScopeRates(config, budgetState, 'reddit_api');
  return roundUsd(rates.request_cost_usd);
}

function ensureBudgetAndReserve(budgetState, scopes, estimatedCostUsd, reason) {
  if (!budgetState.enabled) return;
  const amount = roundUsd(toNonNegativeNumber(estimatedCostUsd, 0));
  if (amount <= 0) return;

  for (const scope of scopes) {
    const limit = budgetState.limits.get(scope);
    if (!limit?.is_active) continue;

    const current = toNonNegativeNumber(budgetState.spend.get(scope), 0);
    const cap = toNonNegativeNumber(limit.monthly_cap_usd, 0);
    if (current + amount > cap + 1e-9) {
      throw new Error(
        `Monthly cap exceeded for ${scope}: current=${current.toFixed(
          6
        )}, needed=${amount.toFixed(6)}, cap=${cap.toFixed(6)} (${reason})`
      );
    }
  }

  for (const scope of scopes) {
    const current = toNonNegativeNumber(budgetState.spend.get(scope), 0);
    budgetState.spend.set(scope, roundUsd(current + amount));
  }
}

function releaseBudgetReservation(budgetState, scopes, reservedCostUsd) {
  if (!budgetState.enabled) return;
  const amount = roundUsd(toNonNegativeNumber(reservedCostUsd, 0));
  if (amount <= 0) return;

  for (const scope of scopes) {
    const current = toNonNegativeNumber(budgetState.spend.get(scope), 0);
    budgetState.spend.set(scope, roundUsd(Math.max(0, current - amount)));
  }
}

function settleBudgetReservation(budgetState, scopes, reservedCostUsd, actualCostUsd) {
  if (!budgetState.enabled) return;
  const reserved = roundUsd(toNonNegativeNumber(reservedCostUsd, 0));
  const actual = roundUsd(toNonNegativeNumber(actualCostUsd, 0));
  if (reserved === actual) return;

  if (actual < reserved) {
    releaseBudgetReservation(budgetState, scopes, reserved - actual);
    return;
  }

  const delta = actual - reserved;
  for (const scope of scopes) {
    const limit = budgetState.limits.get(scope);
    if (!limit?.is_active) continue;

    const current = toNonNegativeNumber(budgetState.spend.get(scope), 0);
    const cap = toNonNegativeNumber(limit.monthly_cap_usd, 0);
    if (current + delta > cap + 1e-9) {
      throw new Error(
        `Actual cost adjustment breached cap for ${scope}: current=${current.toFixed(
          6
        )}, delta=${delta.toFixed(6)}, cap=${cap.toFixed(6)}`
      );
    }
  }

  for (const scope of scopes) {
    const current = toNonNegativeNumber(budgetState.spend.get(scope), 0);
    budgetState.spend.set(scope, roundUsd(current + delta));
  }
}

async function recordBudgetEvent(config, event) {
  await supabaseRequest(config, 'pipeline_budget_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: [event],
  });
}

async function fetchRedditAccessToken(config) {
  if (!config.redditClientId || !config.redditClientSecret) return null;

  const credentials = Buffer.from(`${config.redditClientId}:${config.redditClientSecret}`).toString(
    'base64'
  );
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.redditUserAgent,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Reddit token request failed (${response.status}): ${txt.slice(0, 500)}`);
  }

  const payload = await response.json();
  return payload.access_token ?? null;
}

function normalizeRedditListingChildren(json) {
  const children = json?.data?.children;
  if (!Array.isArray(children)) return [];
  const out = [];

  for (const item of children) {
    if (!item || typeof item !== 'object') continue;
    const data = item.data ?? {};
    const body = normalizeText(data.body);
    if (!body) continue;

    const commentIdRaw = normalizeText(data.id || data.name);
    if (!commentIdRaw) continue;
    const commentId = commentIdRaw.replace(/^t1_/, '');
    const postId = normalizeText(data.link_id).replace(/^t3_/, '') || null;

    out.push({
      source_post_id: postId,
      source_comment_id: commentId,
      source_url: data.permalink ? `https://reddit.com${data.permalink}` : '',
      source_author: normalizeText(data.author) || null,
      comment_body: body,
      comment_score: Number.isFinite(data.score) ? data.score : null,
      commented_at: toIsoFromUnix(Number(data.created_utc)),
      raw_payload: data,
    });
  }

  return out;
}

async function fetchRedditComments(config, accessToken, subreddit, limit) {
  const baseUrl = accessToken ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const url = new URL(`${baseUrl}/r/${encodeURIComponent(subreddit)}/comments.json`);
  url.searchParams.set('limit', String(limit));

  const headers = {
    'User-Agent': config.redditUserAgent,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(
      `Reddit comments fetch failed for r/${subreddit} (${response.status}): ${txt.slice(0, 500)}`
    );
  }

  const payload = await response.json();
  const normalized = normalizeRedditListingChildren(payload).map((row) => ({
    ...row,
    subreddit,
  }));
  return normalized;
}

function dedupeComments(comments) {
  const seen = new Set();
  const out = [];
  for (const c of comments) {
    const key = c.source_comment_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function createIngestRun(config) {
  const rows = await supabaseRequest(config, 'ingest_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [
      {
        source_platform: 'reddit',
        subreddits: config.redditSubreddits,
        status: 'running',
        pull_started_at: nowIso(),
      },
    ],
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Failed to create ingest_runs row');
  }
  return rows[0];
}

async function updateIngestRun(config, runId, patch) {
  await supabaseRequest(config, 'ingest_runs', {
    method: 'PATCH',
    query: { id: `eq.${runId}` },
    headers: { Prefer: 'return=minimal' },
    body: patch,
  });
}

async function upsertRawComments(config, ingestRunId, comments) {
  if (comments.length === 0) return [];
  const payload = comments.map((c) => ({
    ingest_run_id: ingestRunId,
    source_platform: 'reddit',
    subreddit: c.subreddit,
    source_post_id: c.source_post_id,
    source_comment_id: c.source_comment_id,
    source_url: c.source_url,
    source_author: c.source_author,
    comment_body: c.comment_body,
    comment_score: c.comment_score,
    commented_at: c.commented_at,
    raw_payload: c.raw_payload,
  }));

  return supabaseRequest(config, 'raw_reddit_comments', {
    method: 'POST',
    query: { on_conflict: 'source_platform,source_comment_id' },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  });
}

async function fetchExistingMentionCommentIds(config, sourceCommentIds) {
  const found = new Set();
  if (!sourceCommentIds.length) return found;

  const chunked = chunks(sourceCommentIds, 75);
  for (const chunk of chunked) {
    const rows = await supabaseRequest(config, 'player_sentiment_mentions', {
      method: 'GET',
      query: {
        select: 'source_comment_id',
        source_platform: 'eq.reddit',
        source_comment_id: `in.(${chunk.join(',')})`,
      },
    });
    for (const row of rows ?? []) {
      if (row?.source_comment_id) found.add(row.source_comment_id);
    }
  }
  return found;
}

async function loadCardCatalog(config) {
  if (!config.cardCatalogFile) {
    return { list: [], lookup: new Map() };
  }

  const resolvedPath = path.isAbsolute(config.cardCatalogFile)
    ? config.cardCatalogFile
    : path.join(process.cwd(), config.cardCatalogFile);

  const raw = await fs.readFile(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`CARD_CATALOG_FILE must be a JSON array: ${resolvedPath}`);
  }

  const list = [];
  const lookup = new Map();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const player_name = normalizeText(item.player_name || item.name);
    const base_ovr = Number(item.base_ovr);
    const base_position = normalizePosition(item.base_position);
    const program_promo = normalizeText(item.program_promo || item.program || 'Unknown');
    if (!player_name || !Number.isFinite(base_ovr) || !base_position) continue;

    const clean = { player_name, base_ovr, base_position, program_promo };
    list.push(clean);

    const aliases = Array.isArray(item.aliases) ? item.aliases : [];
    const keys = [player_name, ...aliases].map(normalizeKey).filter(Boolean);
    for (const key of keys) {
      if (!lookup.has(key)) lookup.set(key, clean);
    }
  }

  return { list, lookup };
}

function catalogPromptHint(catalog) {
  if (!catalog.list.length) return 'No active card catalog provided.';
  const preview = catalog.list
    .slice(0, 60)
    .map((c) => `${c.player_name} (${c.base_ovr}, ${c.base_position}, ${c.program_promo})`)
    .join('; ');
  return `Active card hints (prefer these identities when possible): ${preview}`;
}

async function extractWithOpenAi(config, prompt) {
  if (!config.openAiApiKey) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openAiModel,
      temperature: config.llmTemperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract FC Mobile player-card opinions from Reddit comments. Return strict JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text.slice(0, 1000)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = extractFirstJsonObject(content);
  if (!parsed) throw new Error('OpenAI returned non-JSON content');

  const usage = payload?.usage ?? {};
  return {
    parsed,
    usage: {
      inputTokens: Number(usage.prompt_tokens) || 0,
      outputTokens: Number(usage.completion_tokens) || 0,
      totalTokens: Number(usage.total_tokens) || 0,
    },
  };
}

async function extractWithGemini(config, prompt) {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
  }

  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      config.geminiModel
    )}:generateContent`
  );
  url.searchParams.set('key', config.geminiApiKey);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.llmTemperature,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 1000)}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = extractFirstJsonObject(text);
  if (!parsed) throw new Error('Gemini returned non-JSON content');

  const usage = payload?.usageMetadata ?? {};
  return {
    parsed,
    usage: {
      inputTokens: Number(usage.promptTokenCount) || 0,
      outputTokens: Number(usage.candidatesTokenCount) || 0,
      totalTokens: Number(usage.totalTokenCount) || 0,
    },
  };
}

async function llmExtractMentions(config, catalog, comment) {
  const prompt = [
    'Task: Extract FC Mobile player-card sentiment mentions from the Reddit comment.',
    'Return JSON with this exact top-level shape: {"mentions":[...]}',
    'Each mention object fields:',
    '- player_name (string, required)',
    '- base_ovr (integer, required if known)',
    '- base_position (string, required if known)',
    '- program_promo (string, required if known)',
    '- mentioned_rank_text (string|null, e.g. "Red" or "4")',
    '- mentioned_position (string|null)',
    '- played_position (string|null)',
    '- is_out_of_position (boolean)',
    '- sentiment_score (number 1-10)',
    '- pros (string array)',
    '- cons (string array)',
    '- llm_summary (short string)',
    'Rules:',
    '- If no FC Mobile player opinion exists, return {"mentions":[]}.',
    '- Do not hallucinate players.',
    '- Prefer card identities from active card hints when they match the text.',
    '- If confidence is low on any required player field, leave mention out.',
    '',
    `Subreddit: ${comment.subreddit}`,
    `Comment URL: ${comment.source_url}`,
    `Comment text: ${comment.comment_body}`,
    '',
    catalogPromptHint(catalog),
  ].join('\n');

  if (config.llmProvider === 'gemini') {
    const result = await extractWithGemini(config, prompt);
    return { provider: 'gemini', ...result };
  }

  const result = await extractWithOpenAi(config, prompt);
  return { provider: 'openai', ...result };
}

function resolveFromCatalog(rawMention, catalog) {
  const mention = { ...rawMention };
  const name = normalizeText(mention.player_name || mention.name);
  if (!name) return null;

  const nameWithoutOvrPrefix = name.replace(/^\d{2,3}\s+/, '').trim();
  const direct = catalog.lookup.get(normalizeKey(name));
  const noOvr = catalog.lookup.get(normalizeKey(nameWithoutOvrPrefix));
  const match = direct || noOvr || null;

  mention.player_name = match?.player_name ?? nameWithoutOvrPrefix ?? name;
  mention.base_ovr = Number.isFinite(Number(mention.base_ovr))
    ? Number(mention.base_ovr)
    : Number(match?.base_ovr);
  mention.base_position =
    normalizePosition(mention.base_position) ?? normalizePosition(match?.base_position);
  mention.program_promo =
    normalizeText(mention.program_promo || mention.program || match?.program_promo) || null;

  return mention;
}

function sanitizeMention(rawMention, catalog) {
  const merged = resolveFromCatalog(rawMention, catalog);
  if (!merged) return null;

  const player_name = normalizeText(merged.player_name);
  const base_ovr = Number(merged.base_ovr);
  const base_position = normalizePosition(merged.base_position);
  const program_promo = normalizeText(merged.program_promo || 'Unknown');
  const sentiment_score = clampScore(merged.sentiment_score ?? merged.score, 1, 10);

  if (!player_name || !Number.isFinite(base_ovr) || !base_position || !sentiment_score) {
    return null;
  }

  const mentioned_position = normalizePosition(merged.mentioned_position);
  const played_position = normalizePosition(merged.played_position);
  const is_out_of_position =
    Boolean(merged.is_out_of_position) ||
    Boolean(played_position && base_position && played_position !== base_position);

  return {
    player_name: player_name.slice(0, 120),
    base_ovr,
    base_position,
    program_promo: program_promo.slice(0, 80),
    mentioned_rank_text: normalizeText(merged.mentioned_rank_text || merged.rank_text || null) || null,
    mentioned_position,
    played_position,
    is_out_of_position,
    sentiment_score,
    pros: sanitizeTermArray(merged.pros),
    cons: sanitizeTermArray(merged.cons),
    llm_summary: normalizeText(merged.llm_summary || merged.summary || '').slice(0, 800) || null,
    extraction_json: rawMention,
  };
}

async function loadPlayersToCache(config) {
  const rows = await supabaseRequest(config, 'players', {
    method: 'GET',
    query: {
      select: 'id,player_name,base_ovr,base_position,program_promo',
      is_active: 'eq.true',
      limit: 5000,
    },
  });

  const cache = new Map();
  for (const row of rows ?? []) {
    const key = playerIdentityKey(row);
    cache.set(key, row.id);
  }
  return cache;
}

async function ensurePlayerId(config, playerCache, mention) {
  const key = playerIdentityKey(mention);
  const existing = playerCache.get(key);
  if (existing) return existing;

  const playerPayload = {
    player_name: mention.player_name,
    base_ovr: mention.base_ovr,
    base_position: mention.base_position,
    program_promo: mention.program_promo,
    is_active: true,
  };

  try {
    const inserted = await supabaseRequest(config, 'players', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [playerPayload],
    });
    const id = inserted?.[0]?.id;
    if (!id) throw new Error('Insert succeeded but no player id returned');
    playerCache.set(key, id);
    return id;
  } catch (err) {
    // Handle rare race/unique conflict by querying and returning existing row.
    const rows = await supabaseRequest(config, 'players', {
      method: 'GET',
      query: {
        select: 'id',
        player_name: `ilike.${mention.player_name}`,
        base_ovr: `eq.${mention.base_ovr}`,
        base_position: `eq.${mention.base_position}`,
        program_promo: `ilike.${mention.program_promo}`,
        limit: 1,
      },
    });
    const id = rows?.[0]?.id;
    if (!id) throw err;
    playerCache.set(key, id);
    return id;
  }
}

async function upsertMentions(config, rows) {
  if (!rows.length) return [];
  return supabaseRequest(config, 'player_sentiment_mentions', {
    method: 'POST',
    query: { on_conflict: 'source_platform,source_comment_id,player_id' },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: rows,
  });
}

async function refreshMaterializedSummary(config) {
  await supabaseRequest(config, 'rpc/refresh_player_sentiment_summary', {
    method: 'POST',
    body: {},
  });
}

async function main() {
  const config = makeConfig();
  log('Starting pipeline run');
  log('Config summary', {
    subreddits: config.redditSubreddits,
    llmProvider: config.llmProvider,
    dryRun: config.dryRun,
    maxCommentsPerRun: config.maxCommentsPerRun,
  });

  let ingestRun = null;
  let budgetState = {
    enabled: false,
    monthStartIso: currentUtcMonthStartIso(),
    limits: new Map(),
    spend: new Map(),
  };
  let budgetBlocked = false;
  const stats = {
    raw_comments_count: 0,
    processed_mentions_count: 0,
    inserted_mentions_count: 0,
    skipped_existing_comments: 0,
    skipped_short_comments: 0,
    llm_calls: 0,
    budget_halts: 0,
    error_count: 0,
    errors: [],
  };

  try {
    ingestRun = await createIngestRun(config);
    log(`Created ingest run ${ingestRun.id}`);

    budgetState = await initializeBudgetState(config);
    if (budgetState.enabled) {
      log('Budget guard active', {
        month_start: budgetState.monthStartIso,
        spend_usd: Object.fromEntries(budgetState.spend.entries()),
      });
    } else {
      log('Budget guard disabled');
    }

    let redditToken = null;
    try {
      redditToken = await fetchRedditAccessToken(config);
      if (redditToken) log('Using Reddit OAuth token flow');
      else log('Reddit OAuth not configured, using public JSON endpoints');
    } catch (err) {
      log(`OAuth token fetch failed, continuing without OAuth: ${err.message}`);
    }

    const fetchedBySubreddit = [];
    for (const subreddit of config.redditSubreddits) {
      const redditScopes = ['reddit_api'];
      const reservedRedditCost = estimateRedditRequestCostUsd(config, budgetState);

      try {
        ensureBudgetAndReserve(
          budgetState,
          redditScopes,
          reservedRedditCost,
          `reddit request r/${subreddit}`
        );
      } catch (err) {
        budgetBlocked = true;
        stats.budget_halts += 1;
        stats.error_count += 1;
        stats.errors.push(`Budget block before r/${subreddit}: ${err.message}`);
        log(`Budget blocked Reddit request for r/${subreddit}: ${err.message}`);
        break;
      }

      let rows;
      try {
        rows = await fetchRedditComments(
          config,
          redditToken,
          subreddit,
          config.redditLimitPerSubreddit
        );
      } catch (err) {
        releaseBudgetReservation(budgetState, redditScopes, reservedRedditCost);
        throw new Error(`Failed fetching r/${subreddit}: ${err.message}`);
      }

      fetchedBySubreddit.push({ subreddit, rows });

      if (!config.dryRun && budgetState.enabled && reservedRedditCost > 0) {
        try {
          await recordBudgetEvent(config, {
            scope: 'reddit_api',
            provider: 'reddit',
            event_type: 'reddit_request',
            estimated_cost_usd: reservedRedditCost,
            input_tokens: null,
            output_tokens: null,
            requests: 1,
            metadata: { subreddit },
            occurred_at: nowIso(),
          });
        } catch (err) {
          stats.error_count += 1;
          stats.errors.push(`Budget event write failed for r/${subreddit}: ${err.message}`);
        }
      }
    }

    const fetched = fetchedBySubreddit.flatMap((r) => r.rows);
    const deduped = dedupeComments(fetched).slice(0, config.maxCommentsPerRun);
    stats.raw_comments_count = deduped.length;
    log(`Fetched ${fetched.length} comments, ${deduped.length} after dedupe/cap`);

    if (!deduped.length) {
      const emptyStatus = budgetBlocked || stats.error_count > 0 ? 'partial' : 'completed';
      await updateIngestRun(config, ingestRun.id, {
        status: emptyStatus,
        raw_comments_count: 0,
        processed_mentions_count: 0,
        inserted_mentions_count: 0,
        error_count: stats.error_count,
        error_log: stats.errors.slice(0, 40).join('\n') || null,
        pull_finished_at: nowIso(),
      });
      log('No comments found; run finalized', { status: emptyStatus });
      return;
    }

    const rawRows = config.dryRun ? [] : await upsertRawComments(config, ingestRun.id, deduped);
    const rawByCommentId = new Map();
    for (const row of rawRows) {
      rawByCommentId.set(row.source_comment_id, row);
    }

    const existingMentionCommentIds = config.dryRun
      ? new Set()
      : await fetchExistingMentionCommentIds(
          config,
          deduped.map((c) => c.source_comment_id)
        );
    log(`Existing processed comments detected: ${existingMentionCommentIds.size}`);

    const catalog = await loadCardCatalog(config);
    log(`Loaded ${catalog.list.length} active card catalog entries`);

    const playerCache = config.dryRun ? new Map() : await loadPlayersToCache(config);
    log(`Player cache warm count: ${playerCache.size}`);

    for (const comment of deduped) {
      if (stats.llm_calls >= config.maxLlmCallsPerRun) {
        log(`Reached MAX_LLM_CALLS_PER_RUN=${config.maxLlmCallsPerRun}; stopping early`);
        break;
      }

      if (existingMentionCommentIds.has(comment.source_comment_id)) {
        stats.skipped_existing_comments += 1;
        continue;
      }

      if (comment.comment_body.length < config.minCommentLength) {
        stats.skipped_short_comments += 1;
        continue;
      }

      const llmProvider = config.llmProvider === 'gemini' ? 'gemini' : 'openai';
      const llmScopes = ['llm_total', llmProviderScope(llmProvider)];
      const reservedLlmCost = estimateLlmCostUsd(config, budgetState, llmProvider);

      try {
        ensureBudgetAndReserve(
          budgetState,
          llmScopes,
          reservedLlmCost,
          `llm completion for comment ${comment.source_comment_id}`
        );
      } catch (err) {
        budgetBlocked = true;
        stats.budget_halts += 1;
        stats.error_count += 1;
        stats.errors.push(`Budget block before LLM call ${comment.source_comment_id}: ${err.message}`);
        log(`Budget blocked LLM call for ${comment.source_comment_id}: ${err.message}`);
        break;
      }

      let extraction;
      try {
        extraction = await llmExtractMentions(config, catalog, comment);
      } catch (err) {
        releaseBudgetReservation(budgetState, llmScopes, reservedLlmCost);
        stats.error_count += 1;
        stats.errors.push(`LLM error for ${comment.source_comment_id}: ${err.message}`);
        continue;
      }
      stats.llm_calls += 1;

      const actualInputTokens = Number(extraction?.usage?.inputTokens) || 0;
      const actualOutputTokens = Number(extraction?.usage?.outputTokens) || 0;
      const actualLlmCost = calculateLlmCostUsd(
        config,
        budgetState,
        extraction?.provider || llmProvider,
        actualInputTokens || config.llmEstimatedInputTokensPerCall,
        actualOutputTokens || config.llmEstimatedOutputTokensPerCall
      );

      try {
        settleBudgetReservation(budgetState, llmScopes, reservedLlmCost, actualLlmCost);
      } catch (err) {
        budgetBlocked = true;
        stats.budget_halts += 1;
        stats.error_count += 1;
        stats.errors.push(
          `Budget adjustment failed for ${comment.source_comment_id}: ${err.message}`
        );
        log(`Budget adjustment blocked further processing: ${err.message}`);
        break;
      }

      if (!config.dryRun && budgetState.enabled && actualLlmCost > 0) {
        try {
          for (const scope of llmScopes) {
            await recordBudgetEvent(config, {
              scope,
              provider: extraction?.provider || llmProvider,
              event_type: 'llm_completion',
              estimated_cost_usd: actualLlmCost,
              input_tokens: actualInputTokens || null,
              output_tokens: actualOutputTokens || null,
              requests: 1,
              metadata: {
                source_comment_id: comment.source_comment_id,
                source_subreddit: comment.subreddit,
                llm_model:
                  (extraction?.provider || llmProvider) === 'gemini'
                    ? config.geminiModel
                    : config.openAiModel,
              },
              occurred_at: nowIso(),
            });
          }
        } catch (err) {
          stats.error_count += 1;
          stats.errors.push(`Budget event write failed for ${comment.source_comment_id}: ${err.message}`);
        }
      }

      if (config.llmSleepMs > 0) await sleep(config.llmSleepMs);

      const mentionsRaw = Array.isArray(extraction?.parsed?.mentions)
        ? extraction.parsed.mentions
        : [];
      const mentions = mentionsRaw
        .map((m) => sanitizeMention(m, catalog))
        .filter(Boolean);
      stats.processed_mentions_count += mentions.length;

      if (!mentions.length || config.dryRun) continue;

      const rawRow = rawByCommentId.get(comment.source_comment_id);
      const mentionRows = [];
      for (const mention of mentions) {
        try {
          const playerId = await ensurePlayerId(config, playerCache, mention);
          mentionRows.push({
            ingest_run_id: ingestRun.id,
            raw_comment_id: rawRow?.id ?? null,
            player_id: playerId,

            source_platform: 'reddit',
            source_subreddit: comment.subreddit,
            source_comment_id: comment.source_comment_id,
            source_url: comment.source_url,

            mentioned_rank_text: mention.mentioned_rank_text,
            mentioned_position: mention.mentioned_position,
            played_position: mention.played_position,
            is_out_of_position: mention.is_out_of_position,

            sentiment_score: mention.sentiment_score,
            pros: mention.pros,
            cons: mention.cons,
            llm_summary: mention.llm_summary,

            llm_model:
              (extraction?.provider || llmProvider) === 'gemini'
                ? `${config.geminiModel}`
                : `${config.openAiModel}`,
            llm_version: null,
            llm_processed_at: nowIso(),
            extraction_json: mention.extraction_json,
          });
        } catch (err) {
          stats.error_count += 1;
          stats.errors.push(`Player link error for ${comment.source_comment_id}: ${err.message}`);
        }
      }

      if (mentionRows.length) {
        try {
          const inserted = await upsertMentions(config, mentionRows);
          stats.inserted_mentions_count += Array.isArray(inserted) ? inserted.length : 0;
        } catch (err) {
          stats.error_count += 1;
          stats.errors.push(`Insert mention error for ${comment.source_comment_id}: ${err.message}`);
        }
      }
    }

    if (!config.dryRun) {
      try {
        await refreshMaterializedSummary(config);
      } catch (err) {
        stats.error_count += 1;
        stats.errors.push(`MV refresh error: ${err.message}`);
      }
    }

    const status = stats.error_count > 0 || budgetBlocked ? 'partial' : 'completed';
    await updateIngestRun(config, ingestRun.id, {
      status,
      raw_comments_count: stats.raw_comments_count,
      processed_mentions_count: stats.processed_mentions_count,
      inserted_mentions_count: stats.inserted_mentions_count,
      error_count: stats.error_count,
      error_log: stats.errors.slice(0, 40).join('\n') || null,
      pull_finished_at: nowIso(),
    });

    log('Run finished', {
      status,
      raw_comments_count: stats.raw_comments_count,
      processed_mentions_count: stats.processed_mentions_count,
      inserted_mentions_count: stats.inserted_mentions_count,
      skipped_existing_comments: stats.skipped_existing_comments,
      skipped_short_comments: stats.skipped_short_comments,
      llm_calls: stats.llm_calls,
      budget_halts: stats.budget_halts,
      error_count: stats.error_count,
      budget_spend_usd: Object.fromEntries(budgetState.spend.entries()),
    });
  } catch (err) {
    log(`Pipeline failed: ${err.message}`);
    if (ingestRun?.id) {
      try {
        await updateIngestRun(config, ingestRun.id, {
          status: 'failed',
          raw_comments_count: stats.raw_comments_count,
          processed_mentions_count: stats.processed_mentions_count,
          inserted_mentions_count: stats.inserted_mentions_count,
          error_count: stats.error_count + 1,
          error_log: `${stats.errors.join('\n')}\n${err.message}`.slice(0, 10000),
          pull_finished_at: nowIso(),
        });
      } catch (innerErr) {
        log(`Failed to mark ingest run as failed: ${innerErr.message}`);
      }
    }
    process.exitCode = 1;
  }
}

main();
