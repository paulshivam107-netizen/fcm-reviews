export type PageType = "card" | "review" | "community";
export type FetchMode = "http" | "api" | "scrapling";
export type ReviewKind = "editorial" | "community";
export type ResolutionStatus = "matched" | "alias-match" | "fuzzy-match" | "unresolved";

export interface FetchResult {
  url: string;
  status: number;
  ok: boolean;
  fetchedAt: string;
  fetchMode: FetchMode;
  mimeType: string | null;
  headers: Record<string, string>;
  body: string;
}

export interface ParsedCard {
  sourceUrl: string;
  externalId?: string | null;
  title: string;
  body: string;
  playerName: string;
  versionName?: string | null;
  eventName?: string | null;
  ovr?: number | null;
  primaryPosition?: string | null;
  altPositions?: string[];
  stats?: Record<string, number>;
  publishedAt?: string | null;
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ParsedReview {
  sourceUrl: string;
  externalId?: string | null;
  title: string;
  body: string;
  playerName: string;
  versionName?: string | null;
  eventName?: string | null;
  ovr?: number | null;
  position?: string | null;
  rating?: number | null;
  pros?: string[];
  cons?: string[];
  authorName?: string | null;
  reviewKind: ReviewKind;
  publishedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ParsedMention {
  sourceUrl: string;
  externalId?: string | null;
  title?: string | null;
  body: string;
  sourcePlatform: string;
  sourceCommunity?: string | null;
  playerName: string;
  versionName?: string | null;
  eventName?: string | null;
  ovr?: number | null;
  position?: string | null;
  sentimentScore?: number | null;
  pros?: string[];
  cons?: string[];
  authorName?: string | null;
  publishedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NormalizedCardVersion {
  canonicalPlayerName: string;
  canonicalPlayerSlug: string;
  versionName: string;
  versionSlug: string;
  eventName: string | null;
  ovr: number | null;
  primaryPosition: string | null;
  altPositions: string[];
  stats: Record<string, number>;
  imageUrl: string | null;
  contentHash: string;
  sourceName: string;
  sourceUrl: string;
  externalId: string | null;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface NormalizedReview {
  title: string;
  body: string;
  playerName: string;
  versionName: string | null;
  eventName: string | null;
  ovr: number | null;
  position: string | null;
  rating: number | null;
  pros: string[];
  cons: string[];
  authorName: string | null;
  contentHash: string;
  sourceName: string;
  sourceUrl: string;
  externalId: string | null;
  publishedAt: string | null;
  reviewKind: ReviewKind;
  metadata: Record<string, unknown>;
}

export interface ParsedOutput {
  cards: ParsedCard[];
  reviews: ParsedReview[];
  mentions: ParsedMention[];
}

export interface DiscoveredUrl {
  url: string;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DiscoverContext {
  nowIso: string;
  maxUrls: number;
}

export interface ParseContext {
  nowIso: string;
}

export interface SourceAdapter {
  name: string;
  pageType: PageType;
  fetchMode: FetchMode;
  discoverUrls(context: DiscoverContext): Promise<DiscoveredUrl[]>;
  parsePage(fetchResult: FetchResult, context: ParseContext): Promise<ParsedOutput>;
}

export interface ResolutionCandidate {
  cardVersionId: string;
  cardId: string;
  cardName: string;
  versionName: string;
  eventName: string | null;
  ovr: number | null;
  primaryPosition: string | null;
  alias: string | null;
}

export interface ResolutionResult {
  status: ResolutionStatus;
  confidence: number;
  matchedCardVersionId: string | null;
  matchedCardId: string | null;
  matchedBy: "exact" | "alias" | "fuzzy" | "none";
  candidate: ResolutionCandidate | null;
}

export interface ScrapeRunCounters {
  discovered: number;
  fetched: number;
  parsed: number;
  upserted: number;
  failed: number;
}
