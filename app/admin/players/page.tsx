"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminArchiveStaleResponse,
  AdminPlayerItem,
  AdminPlayerMutationResponse,
  AdminPlayersListResponse,
} from "@/types/admin";

type FetchState = "idle" | "loading" | "success" | "error";
type AuthState = "checking" | "authenticated" | "unauthenticated";
type RowActionState = "saving" | "deleting" | null;

type EditDraft = {
  playerName: string;
  baseOvr: string;
  basePosition: string;
  programPromo: string;
  isActive: boolean;
};

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function sentimentLabel(score: number | null) {
  if (score === null || Number.isNaN(score)) return "N/A";
  return `${score.toFixed(1)}/10`;
}

function normalizePositionInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

export default function AdminPlayersPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [rows, setRows] = useState<AdminPlayerItem[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [editById, setEditById] = useState<Record<string, EditDraft>>({});
  const [actionById, setActionById] = useState<Record<string, RowActionState>>({});
  const [archiveDays, setArchiveDays] = useState("30");
  const [isArchiving, setIsArchiving] = useState(false);

  const loadPlayers = useCallback(async () => {
    if (authState !== "authenticated") {
      setRows([]);
      setState("idle");
      return;
    }

    setState("loading");
    setError(null);

    try {
      const params = new URLSearchParams({
        q: query,
        limit: "80",
        includeInactive: includeInactive ? "true" : "false",
      });
      const response = await fetch(`/api/admin/players?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;

        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          setRows([]);
          setState("idle");
          setError("Session expired. Please sign in again.");
          return;
        }

        throw new Error(message);
      }

      const data = payload as AdminPlayersListResponse;
      setRows(data.items);
      setState("success");
    } catch (loadError) {
      setRows([]);
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Unknown error");
    }
  }, [authState, includeInactive, query]);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      setAuthState("checking");
      try {
        const response = await fetch("/api/admin/auth/me", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setAuthState("unauthenticated");
            setAdminEmail(null);
          }
          return;
        }

        const payload = (await response.json()) as { email?: string };
        if (!cancelled) {
          setAdminEmail(String(payload.email ?? "").trim() || null);
          setAuthState("authenticated");
        }
      } catch {
        if (!cancelled) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
        }
      }
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadPlayers();
  }, [loadPlayers]);

  const pendingEdits = useMemo(() => Object.keys(editById).length, [editById]);

  const onSubmitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setIsLoggingIn(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const payload = (await response.json()) as {
        error?: string;
        email?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? `Login failed (${response.status})`);
      }

      setAdminEmail(payload.email ?? email);
      setLoginPassword("");
      setAuthState("authenticated");
      setFeedback("Signed in to admin tools.");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
      setAuthState("unauthenticated");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const onLogout = async () => {
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
    } finally {
      setAuthState("unauthenticated");
      setAdminEmail(null);
      setRows([]);
      setState("idle");
      setFeedback("Signed out.");
      setError(null);
      setEditById({});
      setActionById({});
    }
  };

  const onSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(queryDraft.trim());
  };

  const startEdit = (row: AdminPlayerItem) => {
    setEditById((current) => ({
      ...current,
      [row.playerId]: {
        playerName: row.playerName,
        baseOvr: String(row.baseOvr),
        basePosition: row.basePosition,
        programPromo: row.programPromo,
        isActive: row.isActive,
      },
    }));
  };

  const cancelEdit = (playerId: string) => {
    setEditById((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  };

  const updateDraft = (playerId: string, patch: Partial<EditDraft>) => {
    setEditById((current) => {
      const existing = current[playerId];
      if (!existing) return current;
      return {
        ...current,
        [playerId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const saveEdit = async (playerId: string) => {
    const draft = editById[playerId];
    if (!draft) return;

    const trimmedName = draft.playerName.trim();
    if (trimmedName.length < 2) {
      setError("Player name must be at least 2 characters.");
      return;
    }

    const baseOvr = Number(draft.baseOvr);
    if (!Number.isInteger(baseOvr) || baseOvr < 1 || baseOvr > 130) {
      setError("Base OVR must be an integer between 1 and 130.");
      return;
    }

    if (draft.basePosition.length < 2) {
      setError("Base position is required (example: ST, CM, RB).");
      return;
    }

    if (!draft.programPromo.trim()) {
      setError("Event/Program is required.");
      return;
    }

    setActionById((current) => ({ ...current, [playerId]: "saving" }));
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/players", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerId,
          playerName: trimmedName,
          baseOvr,
          basePosition: normalizePositionInput(draft.basePosition),
          programPromo: draft.programPromo.trim(),
          isActive: draft.isActive,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        item?: AdminPlayerItem;
      };
      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }

      if (payload.item) {
        setRows((current) =>
          current.map((row) => (row.playerId === playerId ? payload.item! : row))
        );
      }
      cancelEdit(playerId);
      setFeedback("Player updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Update failed.");
    } finally {
      setActionById((current) => ({ ...current, [playerId]: null }));
    }
  };

  const deletePlayer = async (playerId: string, playerName: string) => {
    const confirmed = window.confirm(
      `Delete ${playerName}? This will archive it from public listings.`
    );
    if (!confirmed) return;

    setActionById((current) => ({ ...current, [playerId]: "deleting" }));
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/players", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playerId }),
      });
      const payload = (await response.json()) as {
        error?: string;
        item?: AdminPlayerItem;
      };
      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }

      if (includeInactive) {
        if (payload.item) {
          setRows((current) =>
            current.map((row) => (row.playerId === playerId ? payload.item! : row))
          );
        }
      } else {
        setRows((current) => current.filter((row) => row.playerId !== playerId));
      }
      cancelEdit(playerId);
      setFeedback("Player archived.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    } finally {
      setActionById((current) => ({ ...current, [playerId]: null }));
    }
  };

  const archiveStalePlayers = async () => {
    const days = Number(archiveDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError("Archive window must be an integer between 1 and 365 days.");
      return;
    }

    setIsArchiving(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/players", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days }),
      });
      const payload = (await response.json()) as
        | AdminArchiveStaleResponse
        | { error?: string };
      if (!response.ok) {
        const message =
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        throw new Error(message);
      }

      const successPayload = payload as AdminArchiveStaleResponse;
      setFeedback(
        `Archived ${successPayload.archivedCount} stale card(s) using ${successPayload.days}-day window.`
      );
      await loadPlayers();
    } catch (archiveError) {
      setError(
        archiveError instanceof Error ? archiveError.message : "Archive failed."
      );
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <header className="mb-5">
        <p className="mb-2 inline-flex items-center rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200">
          Admin
        </p>
        <h1 className="text-2xl font-bold text-slate-100">Player Catalog</h1>
        <p className="mt-2 text-sm text-slate-300">
          Edit base card metadata and archive invalid/outdated cards.
        </p>
      </header>

      {authState === "checking" && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          Checking admin session...
        </div>
      )}

      {authState === "unauthenticated" && (
        <section className="glass-panel mb-5 rounded-2xl p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate-300">
            Admin Sign In
          </p>
          <form onSubmit={onSubmitLogin} className="space-y-3">
            <label className="block text-xs text-slate-300">
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full rounded-xl bg-accent-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </section>
      )}

      {authState === "authenticated" && (
        <>
          <section className="glass-panel mb-5 flex items-center justify-between gap-3 rounded-2xl p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.1em] text-slate-400">Signed in</p>
              <p className="text-sm font-semibold text-slate-100">{adminEmail}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
            >
              Sign Out
            </button>
          </section>

          <nav className="mb-5 flex gap-2" aria-label="Admin tools">
            <Link
              href="/admin/moderation"
              className="rounded-full bg-[var(--bg-pill)] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
            >
              Moderation
            </Link>
            <span className="rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-slate-950">
              Players
            </span>
          </nav>

          <section className="glass-panel mb-5 rounded-2xl p-4">
            <p className="mb-3 text-xs uppercase tracking-[0.1em] text-slate-300">
              Auto Archive Stale Cards
            </p>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <label className="text-xs text-slate-300">
                No update for (days)
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={archiveDays}
                  onChange={(event) => setArchiveDays(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>
              <button
                type="button"
                onClick={archiveStalePlayers}
                disabled={isArchiving}
                className="rounded-xl border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isArchiving ? "Archiving..." : "Archive Stale"}
              </button>
            </div>
          </section>

          <section className="glass-panel mb-5 rounded-2xl p-4">
            <form onSubmit={onSearchSubmit} className="space-y-3">
              <label className="block text-xs text-slate-300">
                Search (name, event, position, or exact OVR)
                <input
                  type="search"
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  placeholder='Try "Raul" or "115"'
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => setIncludeInactive(event.target.checked)}
                />
                Include archived cards
              </label>
              <button
                type="submit"
                className="w-full rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
              >
                Search
              </button>
            </form>
          </section>
        </>
      )}

      {feedback && (
        <div className="mb-4 rounded-xl border border-lime-300/30 bg-lime-300/10 px-3 py-2 text-sm text-lime-100">
          {feedback}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      {authState === "authenticated" && state === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="glass-panel h-32 animate-pulse rounded-2xl border border-white/10"
            />
          ))}
        </div>
      )}

      {authState === "authenticated" && state === "success" && rows.length === 0 && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          No players found.
        </div>
      )}

      {authState === "authenticated" && state === "success" && rows.length > 0 && (
        <section className="space-y-3">
          <p className="text-xs text-slate-400">
            Showing {rows.length} players. {pendingEdits > 0 ? `${pendingEdits} edit(s) in progress.` : ""}
          </p>

          {rows.map((row) => {
            const draft = editById[row.playerId];
            const actionState = actionById[row.playerId];
            const isBusy = actionState !== null;
            return (
              <article
                key={row.playerId}
                className="glass-panel rounded-2xl border border-white/10 p-4"
              >
                {!draft && (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-100">
                          {row.playerName} · {row.baseOvr} · {row.basePosition}
                        </h2>
                        <p className="mt-1 text-xs text-slate-300">
                          {row.programPromo} · {row.isActive ? "Active" : "Archived"}
                        </p>
                      </div>
                      <p className="text-xs font-semibold text-lime-200">
                        {sentimentLabel(row.avgSentimentScore)}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Mentions: {row.mentionCount} · Updated {formatWhen(row.updatedAt)}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
                      >
                        Edit
                      </button>
                      {row.isActive && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => deletePlayer(row.playerId, row.playerName)}
                          className="rounded-xl border border-rose-300/35 bg-rose-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {actionState === "deleting" ? "Deleting..." : "Delete"}
                        </button>
                      )}
                    </div>
                  </>
                )}

                {draft && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <label className="col-span-2 text-xs text-slate-300">
                        Player Name
                        <input
                          type="text"
                          value={draft.playerName}
                          onChange={(event) =>
                            updateDraft(row.playerId, { playerName: event.target.value })
                          }
                          maxLength={72}
                          className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                        />
                      </label>
                      <label className="text-xs text-slate-300">
                        Base OVR
                        <input
                          type="number"
                          min={1}
                          max={130}
                          value={draft.baseOvr}
                          onChange={(event) =>
                            updateDraft(row.playerId, { baseOvr: event.target.value })
                          }
                          className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs text-slate-300">
                        Base Position
                        <input
                          type="text"
                          value={draft.basePosition}
                          onChange={(event) =>
                            updateDraft(row.playerId, {
                              basePosition: normalizePositionInput(event.target.value),
                            })
                          }
                          maxLength={4}
                          className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm uppercase text-slate-100 outline-none"
                        />
                      </label>
                      <label className="text-xs text-slate-300">
                        Event/Program
                        <input
                          type="text"
                          value={draft.programPromo}
                          onChange={(event) =>
                            updateDraft(row.playerId, { programPromo: event.target.value })
                          }
                          maxLength={48}
                          className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                        />
                      </label>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(event) =>
                          updateDraft(row.playerId, { isActive: event.target.checked })
                        }
                      />
                      Active card
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => saveEdit(row.playerId)}
                        className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {actionState === "saving" ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => cancelEdit(row.playerId)}
                        className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
