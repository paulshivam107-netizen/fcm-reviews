import { PlayerRow } from "@/types/player";
import { PlayerReviewFeedItem } from "@/types/review";

export type CompareCardPayload = {
  player: PlayerRow;
  reviews: PlayerReviewFeedItem[];
  verdict: string;
  reviewCount: number;
  isEarlySignal: boolean;
};

export type CompareApiResponse = {
  left: CompareCardPayload;
  right: CompareCardPayload | null;
  meta: {
    leftId: string;
    rightId: string | null;
  };
};
