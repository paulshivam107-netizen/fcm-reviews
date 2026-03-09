import { SourceAdapter } from "@/src/core/types/ingestion";
import { communitySourceAdapter } from "@/src/ingestion/parse/parsers/communitySourceAdapter";
import { reviewSourceAdapter } from "@/src/ingestion/parse/parsers/reviewSourceAdapter";
import { cardSourceAdapter } from "@/src/ingestion/parse/parsers/cardSourceAdapter";

export const ingestionConfig = {
  defaultDiscoverLimit: 25,
  defaultFetchTimeoutMs: 12_000,
  cardSourceSeeds: ["https://example.com/fc-mobile/cards/feed.json"],
  reviewSourceSeeds: ["https://example.com/fc-mobile/reviews/feed.json"],
  communitySourceSeeds: ["https://example.com/fc-mobile/community/feed.json"],
};

export const sourceAdapters: SourceAdapter[] = [
  cardSourceAdapter,
  reviewSourceAdapter,
  communitySourceAdapter,
];
