import { NextResponse } from "next/server";
import { getAdsRuntimeConfig } from "@/lib/server/ad-config";
import { AdsConfigApiResponse } from "@/types/ads";

export async function GET() {
  const response: AdsConfigApiResponse = {
    config: getAdsRuntimeConfig(),
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
