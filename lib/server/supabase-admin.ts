type SupabaseServerConfig = {
  supabaseUrl: string;
  supabaseKey: string;
};

export function getSupabaseServerConfig(): SupabaseServerConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return null;
  return { supabaseUrl, supabaseKey };
}

export async function supabaseRestRequest(args: {
  endpoint: string;
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: "return=minimal" | "return=representation";
  cache?: RequestCache;
}) {
  const config = getSupabaseServerConfig();
  if (!config) {
    throw new Error(
      "Missing SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  const { supabaseUrl, supabaseKey } = config;
  const url = new URL(`${supabaseUrl}/rest/v1/${args.endpoint}`);
  for (const [key, value] of Object.entries(args.query ?? {})) {
    url.searchParams.set(key, value);
  }

  return fetch(url, {
    method: args.method ?? "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: args.prefer ?? "return=minimal",
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
    cache: args.cache ?? "no-store",
  });
}

