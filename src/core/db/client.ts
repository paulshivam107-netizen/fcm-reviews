import { getSupabaseServerConfig } from "@/lib/server/supabase-admin";

type UpsertArgs = {
  table: string;
  values: Record<string, unknown> | Array<Record<string, unknown>>;
  onConflict: string;
};

type SelectArgs = {
  table: string;
  select: string;
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
};

type UpdateArgs = {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, string>;
};

export class IngestionDbClient {
  private readonly baseUrl: string;
  private readonly key: string;

  constructor() {
    const config = getSupabaseServerConfig();
    if (!config) {
      throw new Error(
        "Missing SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
      );
    }

    this.baseUrl = config.supabaseUrl;
    this.key = config.supabaseKey;
  }

  private buildUrl(table: string, filters?: Record<string, string>) {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(filters ?? {})) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  private async request<T>(url: URL, init: RequestInit & { prefer?: string }) {
    const response = await fetch(url, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        Prefer: init.prefer ?? "return=representation",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`Supabase ${response.status}: ${details}`);
    }

    if (response.status === 204) {
      return [] as T;
    }

    return (await response.json()) as T;
  }

  async select<T>(args: SelectArgs) {
    const url = this.buildUrl(args.table, args.filters);
    url.searchParams.set("select", args.select);
    if (args.order) {
      url.searchParams.set("order", args.order);
    }
    if (typeof args.limit === "number") {
      url.searchParams.set("limit", String(args.limit));
    }

    return this.request<T>(url, {
      method: "GET",
      prefer: "return=representation",
    });
  }

  async insert<T>(table: string, values: Record<string, unknown> | Array<Record<string, unknown>>) {
    const url = this.buildUrl(table);
    return this.request<T>(url, {
      method: "POST",
      body: JSON.stringify(values),
      prefer: "return=representation",
    });
  }

  async upsert<T>(args: UpsertArgs) {
    const url = this.buildUrl(args.table, {
      on_conflict: args.onConflict,
    });
    return this.request<T>(url, {
      method: "POST",
      body: JSON.stringify(args.values),
      prefer: "resolution=merge-duplicates,return=representation",
    });
  }

  async update<T>(args: UpdateArgs) {
    const url = this.buildUrl(args.table, args.filters);
    return this.request<T>(url, {
      method: "PATCH",
      body: JSON.stringify(args.values),
      prefer: "return=representation",
    });
  }
}

export function createIngestionDbClient() {
  return new IngestionDbClient();
}
