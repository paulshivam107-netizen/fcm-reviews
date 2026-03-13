"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminAuthShell } from "@/components/admin-auth-shell";
import { AdminPageHeader } from "@/components/admin-page-header";
import { AdminSessionBanner } from "@/components/admin-session-banner";
import { AdminToolsNav } from "@/components/admin-tools-nav";
import Link from "next/link";
import {
  getReviewTagsForPosition,
  REVIEW_POSITION_OPTIONS,
  REVIEW_POSITIONS_BY_GROUP,
} from "@/lib/review-attributes";
import {
  AdminArchiveStaleResponse,
  AdminEventOptionsResponse,
  AdminPlayerMergeExecuteResponse,
  AdminPlayerMergePreview,
  AdminPlayerMergePreviewResponse,
  AdminManualReviewResponse,
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

type ManualReviewField = "pros" | "cons";
type ManualReviewDraft = {
  playerName: string;
  playerOvr: string;
  eventName: string;
  playedPosition: string;
  sentimentScore: string;
  mentionedRankText: string;
  pros: string[];
  cons: string[];
  note: string;
};

type MergeActionState = "idle" | "loading-targets" | "previewing" | "merging";

const RANK_OPTIONS = ["", "Base", "Blue", "Purple", "Red", "Gold"] as const;

function buildInitialManualReviewDraft(): ManualReviewDraft {
  return {
    playerName: "",
    playerOvr: "",
    eventName: "",
    playedPosition: "ST",
    sentimentScore: "8",
    mentionedRankText: "",
    pros: [],
    cons: [],
    note: "",
  };
}

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

function sortPlayersByLatest(items: AdminPlayerItem[]) {
  return [...items].sort((a, b) => {
    const aUpdated = new Date(a.updatedAt).getTime();
    const bUpdated = new Date(b.updatedAt).getTime();
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;
    if (a.baseOvr !== b.baseOvr) return b.baseOvr - a.baseOvr;
    return a.playerName.localeCompare(b.playerName);
  });
}

function normalizePositionInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
}

function filterTagsForPosition(tags: string[], position: string) {
  const allowed = new Set(getReviewTagsForPosition(position));
  return tags.filter((tag) => allowed.has(tag));
}

function extractApiErrorMessage(args: {
  payload: unknown;
  fallback: string;
  status: number;
}) {
  const { payload, fallback, status } = args;
  if (!payload || typeof payload !== "object") {
    return `${fallback} (${status})`;
  }

  const errorValue =
    "error" in payload && typeof payload.error === "string"
      ? payload.error.trim()
      : "";
  const detailsValue =
    "details" in payload && typeof payload.details === "string"
      ? payload.details.trim()
      : "";

  if (errorValue && detailsValue && detailsValue !== errorValue) {
    return `${errorValue}: ${detailsValue}`;
  }
  if (errorValue) return errorValue;
  if (detailsValue) return detailsValue;
  return `${fallback} (${status})`;
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
  const [eventOptions, setEventOptions] = useState<string[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [editById, setEditById] = useState<Record<string, EditDraft>>({});
  const [actionById, setActionById] = useState<Record<string, RowActionState>>({});
  const [archiveDays, setArchiveDays] = useState("30");
  const [isArchiving, setIsArchiving] = useState(false);
  const [isManualReviewOpen, setIsManualReviewOpen] = useState(false);
  const [manualReview, setManualReview] = useState<ManualReviewDraft>(() =>
    buildInitialManualReviewDraft()
  );
  const [isSubmittingManualReview, setIsSubmittingManualReview] = useState(false);
  const [mergeSource, setMergeSource] = useState<AdminPlayerItem | null>(null);
  const [mergeTargetQuery, setMergeTargetQuery] = useState("");
  const [mergeTargetRows, setMergeTargetRows] = useState<AdminPlayerItem[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [mergePreview, setMergePreview] = useState<AdminPlayerMergePreview | null>(
    null
  );
  const [mergeActionState, setMergeActionState] = useState<MergeActionState>("idle");

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
      setRows(sortPlayersByLatest(data.items));
      setState("success");
    } catch (loadError) {
      setRows([]);
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Unknown error");
    }
  }, [authState, includeInactive, query]);

  const loadEventOptions = useCallback(async () => {
    if (authState !== "authenticated") {
      setEventOptions([]);
      return;
    }

    try {
      const params = new URLSearchParams({
        includeInactive: "true",
        limit: "1000",
      });
      const response = await fetch(`/api/admin/events?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          setEventOptions([]);
        }
        return;
      }

      const data = payload as AdminEventOptionsResponse;
      setEventOptions(Array.isArray(data.items) ? data.items : []);
    } catch {
      setEventOptions([]);
    }
  }, [authState]);

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

  useEffect(() => {
    void loadEventOptions();
  }, [loadEventOptions]);

  const pendingEdits = useMemo(() => Object.keys(editById).length, [editById]);
  const manualTagOptions = useMemo(
    () => getReviewTagsForPosition(manualReview.playedPosition),
    [manualReview.playedPosition]
  );
  const selectedMergeTarget = useMemo(
    () => mergeTargetRows.find((row) => row.playerId === mergeTargetId) ?? null,
    [mergeTargetRows, mergeTargetId]
  );
  const eventSuggestions = useMemo(() => {
    const deduped = new Map<string, string>();
    const addValue = (value: string | null | undefined) => {
      const normalized = String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, normalized);
      }
    };

    for (const option of eventOptions) addValue(option);
    for (const row of rows) addValue(row.programPromo);
    for (const draft of Object.values(editById)) addValue(draft.programPromo);
    addValue(manualReview.eventName);

    return Array.from(deduped.values()).sort((a, b) => a.localeCompare(b));
  }, [editById, eventOptions, manualReview.eventName, rows]);

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
      setEventOptions([]);
      setState("idle");
      setFeedback("Signed out.");
      setError(null);
      setEditById({});
      setActionById({});
      setIsManualReviewOpen(false);
      setManualReview(buildInitialManualReviewDraft());
      setIsSubmittingManualReview(false);
      setMergeSource(null);
      setMergeTargetQuery("");
      setMergeTargetRows([]);
      setMergeTargetId("");
      setMergePreview(null);
      setMergeActionState("idle");
    }
  };

  const resetMergeState = () => {
    setMergeSource(null);
    setMergeTargetQuery("");
    setMergeTargetRows([]);
    setMergeTargetId("");
    setMergePreview(null);
    setMergeActionState("idle");
  };

  const searchMergeTargets = async (source: AdminPlayerItem, rawQuery: string) => {
    const cleanedQuery = rawQuery.trim() || source.playerName;
    setMergeActionState("loading-targets");
    setError(null);

    try {
      const params = new URLSearchParams({
        q: cleanedQuery,
        limit: "40",
        includeInactive: "false",
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
        throw new Error(message);
      }

      const data = payload as AdminPlayersListResponse;
      const candidates = data.items
        .filter((item) => item.playerId !== source.playerId)
        .sort((a, b) => b.mentionCount - a.mentionCount);

      setMergeTargetRows(candidates);
      if (!candidates.some((item) => item.playerId === mergeTargetId)) {
        setMergeTargetId("");
        setMergePreview(null);
      }
    } catch (searchError) {
      setMergeTargetRows([]);
      setMergeTargetId("");
      setMergePreview(null);
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Failed to search merge targets."
      );
    } finally {
      setMergeActionState("idle");
    }
  };

  const openMergePanel = async (source: AdminPlayerItem) => {
    setMergeSource(source);
    setMergeTargetQuery(source.playerName);
    setMergeTargetRows([]);
    setMergeTargetId("");
    setMergePreview(null);
    setFeedback(null);
    await searchMergeTargets(source, source.playerName);
  };

  const previewMerge = async () => {
    if (!mergeSource || !mergeTargetId) {
      setError("Select a target card first.");
      return;
    }

    setMergeActionState("previewing");
    setError(null);

    try {
      const params = new URLSearchParams({
        sourcePlayerId: mergeSource.playerId,
        targetPlayerId: mergeTargetId,
      });
      const response = await fetch(`/api/admin/players/merge?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | AdminPlayerMergePreviewResponse
        | { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage({
            payload,
            fallback: "Failed to preview card merge",
            status: response.status,
          })
        );
      }

      const previewPayload = payload as AdminPlayerMergePreviewResponse;
      setMergePreview(previewPayload.preview);
    } catch (previewError) {
      setMergePreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Failed to preview merge."
      );
    } finally {
      setMergeActionState("idle");
    }
  };

  const executeMerge = async () => {
    if (!mergeSource || !mergeTargetId) {
      setError("Select a target card first.");
      return;
    }
    if (!mergePreview) {
      setError("Preview the merge before confirming.");
      return;
    }

    const confirmed = window.confirm(
      `Merge "${mergeSource.playerName} ${mergeSource.baseOvr}" into "${mergePreview.targetPlayer.playerName} ${mergePreview.targetPlayer.baseOvr}"? Source card will be archived.`
    );
    if (!confirmed) return;

    setMergeActionState("merging");
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/players/merge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourcePlayerId: mergeSource.playerId,
          targetPlayerId: mergeTargetId,
        }),
      });
      const payload = (await response.json()) as
        | AdminPlayerMergeExecuteResponse
        | { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage({
            payload,
            fallback: "Failed to merge cards",
            status: response.status,
          })
        );
      }

      const summary = (payload as AdminPlayerMergeExecuteResponse).summary;
      setFeedback(
        `Merge complete. Moved ${summary.movedMentionsCount} mentions and ${summary.movedUserReviewsCount} user reviews.`
      );
      resetMergeState();
      await loadPlayers();
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "Merge failed.");
    } finally {
      setMergeActionState("idle");
    }
  };

  const updateManualReview = (patch: Partial<ManualReviewDraft>) => {
    setManualReview((current) => ({ ...current, ...patch }));
  };

  const toggleManualTag = (field: ManualReviewField, tag: string) => {
    setManualReview((current) => {
      const allowed = new Set(getReviewTagsForPosition(current.playedPosition));
      if (!allowed.has(tag)) return current;

      const list = current[field];
      const exists = list.includes(tag);
      const max = field === "pros" ? 3 : 2;
      if (exists) {
        return {
          ...current,
          [field]: list.filter((item) => item !== tag),
        };
      }
      if (list.length >= max) {
        return current;
      }
      return {
        ...current,
        [field]: [...list, tag],
      };
    });
  };

  const submitManualReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const playerName = manualReview.playerName.trim();
    if (playerName.length < 2) {
      setError("Player name must be at least 2 characters.");
      return;
    }

    const playerOvr = Number(manualReview.playerOvr);
    if (!Number.isInteger(playerOvr) || playerOvr < 1 || playerOvr > 130) {
      setError("OVR must be an integer between 1 and 130.");
      return;
    }

    const playedPosition = normalizePositionInput(manualReview.playedPosition);
    if (playedPosition.length < 2) {
      setError("Played position is required (example: ST, CAM, RB).");
      return;
    }

    const sentimentScore = Number(manualReview.sentimentScore);
    if (!Number.isFinite(sentimentScore) || sentimentScore < 1 || sentimentScore > 10) {
      setError("Sentiment score must be between 1 and 10.");
      return;
    }

    setIsSubmittingManualReview(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/admin/reviews/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerName,
          playerOvr,
          eventName: manualReview.eventName.trim() || null,
          sentimentScore,
          playedPosition,
          mentionedRankText: manualReview.mentionedRankText || null,
          pros: manualReview.pros,
          cons: manualReview.cons,
          note: manualReview.note.trim() || null,
        }),
      });

      const payload = (await response.json()) as
        | AdminManualReviewResponse
        | { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        const message =
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      const successPayload = payload as AdminManualReviewResponse;
      setFeedback(successPayload.message);
      setManualReview(buildInitialManualReviewDraft());
      setIsManualReviewOpen(false);
      await Promise.all([loadPlayers(), loadEventOptions()]);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit admin review."
      );
    } finally {
      setIsSubmittingManualReview(false);
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
          programPromo: draft.programPromo.trim() || null,
          isActive: draft.isActive,
        }),
      });

      const payload = (await response.json()) as
        | AdminPlayerMutationResponse
        | { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          setAuthState("unauthenticated");
          setAdminEmail(null);
          throw new Error("Session expired. Please sign in again.");
        }
        const message =
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      if ("item" in payload && payload.item) {
        setRows((current) =>
          sortPlayersByLatest(
            current.map((row) => (row.playerId === playerId ? payload.item! : row))
          )
        );
      }
      cancelEdit(playerId);
      if ("mergedFromPlayerId" in payload && payload.mergedFromPlayerId) {
        setFeedback("Player updated. Reviews were reassigned from the duplicate card.");
      } else {
        setFeedback("Player updated.");
      }
      void loadEventOptions();
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

  if (authState !== "authenticated") {
    return (
      <AdminAuthShell
        title="Player Catalog"
        description="Edit base card metadata and archive invalid/outdated cards."
        status={authState}
        error={error}
        flash={feedback}
        loginEmail={loginEmail}
        loginPassword={loginPassword}
        onLoginEmailChange={setLoginEmail}
        onLoginPasswordChange={setLoginPassword}
        onSubmit={onSubmitLogin}
        isLoggingIn={isLoggingIn}
        signInDescription="Only approved admin emails can access player management tools."
      />
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <AdminPageHeader
        title="Player Catalog"
        description="Edit base card metadata and archive invalid/outdated cards."
      />

      <datalist id="admin-event-options">
            {eventSuggestions.map((eventName) => (
              <option key={eventName} value={eventName} />
            ))}
          </datalist>

          <AdminSessionBanner adminEmail={adminEmail} onLogout={onLogout} />

          <AdminToolsNav active="players" />

          <section className="glass-panel mb-5 rounded-2xl p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="mb-1 text-xs uppercase tracking-[0.1em] text-slate-300">
                  Publish Admin Review
                </p>
                <p className="text-xs text-slate-400">
                  Add a review as admin. It is saved as approved and reflected in card sentiment
                  after refresh.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManualReviewOpen((current) => !current)}
                className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20"
              >
                {isManualReviewOpen ? "Close" : "Add Review"}
              </button>
            </div>

            {isManualReviewOpen && (
              <form onSubmit={submitManualReview} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="col-span-2 text-xs text-slate-300">
                  Player Name
                  <input
                    type="text"
                    value={manualReview.playerName}
                    onChange={(event) =>
                      updateManualReview({ playerName: event.target.value })
                    }
                    maxLength={72}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  OVR
                  <input
                    type="number"
                    min={1}
                    max={130}
                    value={manualReview.playerOvr}
                    onChange={(event) =>
                      updateManualReview({ playerOvr: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-300">
                  Event/Program (optional)
                  <input
                    type="text"
                    value={manualReview.eventName}
                    onChange={(event) =>
                      updateManualReview({ eventName: event.target.value })
                    }
                    list="admin-event-options"
                    maxLength={48}
                    placeholder="Leave blank to use Community"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Played Position
                  <select
                    value={manualReview.playedPosition}
                    onChange={(event) => {
                      const nextPosition = event.target.value;
                      setManualReview((current) => ({
                        ...current,
                        playedPosition: nextPosition,
                        pros: filterTagsForPosition(current.pros, nextPosition),
                        cons: filterTagsForPosition(current.cons, nextPosition),
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm uppercase text-slate-100 outline-none"
                  >
                    <optgroup label="Attacker">
                      {REVIEW_POSITIONS_BY_GROUP.attacker.map((position) => (
                        <option
                          key={position}
                          value={position}
                          className="bg-slate-900 text-slate-100"
                        >
                          {position}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Midfielder">
                      {REVIEW_POSITIONS_BY_GROUP.midfielder.map((position) => (
                        <option
                          key={position}
                          value={position}
                          className="bg-slate-900 text-slate-100"
                        >
                          {position}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Defender">
                      {REVIEW_POSITIONS_BY_GROUP.defender.map((position) => (
                        <option
                          key={position}
                          value={position}
                          className="bg-slate-900 text-slate-100"
                        >
                          {position}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Goalkeeper">
                      {REVIEW_POSITIONS_BY_GROUP.goalkeeper.map((position) => (
                        <option
                          key={position}
                          value={position}
                          className="bg-slate-900 text-slate-100"
                        >
                          {position}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-300">
                  Sentiment (1-10)
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={0.1}
                    value={manualReview.sentimentScore}
                    onChange={(event) =>
                      updateManualReview({ sentimentScore: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Mentioned Rank
                  <select
                    value={manualReview.mentionedRankText}
                    onChange={(event) =>
                      updateManualReview({ mentionedRankText: event.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    {RANK_OPTIONS.map((option) => (
                      <option key={option || "none"} value={option}>
                        {option || "Not mentioned"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div>
                <p className="mb-2 text-xs text-slate-300">
                  Pros tags (max 3) based on played position
                </p>
                <div className="flex flex-wrap gap-2">
                  {manualTagOptions.map((tag) => {
                    const active = manualReview.pros.includes(tag);
                    return (
                      <button
                        key={`pro-${tag}`}
                        type="button"
                        onClick={() => toggleManualTag("pros", tag)}
                        className={[
                          "rounded-full border px-3 py-1 text-xs transition",
                          active
                            ? "border-lime-300/45 bg-lime-300/20 text-lime-100"
                            : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10",
                        ].join(" ")}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs text-slate-300">
                  Cons tags (max 2) based on played position
                </p>
                <div className="flex flex-wrap gap-2">
                  {manualTagOptions.map((tag) => {
                    const active = manualReview.cons.includes(tag);
                    return (
                      <button
                        key={`con-${tag}`}
                        type="button"
                        onClick={() => toggleManualTag("cons", tag)}
                        className={[
                          "rounded-full border px-3 py-1 text-xs transition",
                          active
                            ? "border-rose-300/45 bg-rose-300/20 text-rose-100"
                            : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10",
                        ].join(" ")}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block text-xs text-slate-300">
                Review note (optional)
                <textarea
                  rows={3}
                  value={manualReview.note}
                  onChange={(event) => updateManualReview({ note: event.target.value })}
                  maxLength={220}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmittingManualReview}
                className="w-full rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmittingManualReview ? "Publishing..." : "Publish Review"}
              </button>
              </form>
            )}
          </section>

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

          {mergeSource && (
            <section className="glass-panel mb-5 rounded-2xl border border-amber-300/25 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-amber-100">
                    Merge Cards
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Move mentions and user reviews from source to target, then archive source.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetMergeState}
                  className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
                Source:{" "}
                <span className="font-semibold text-slate-100">
                  {mergeSource.playerName} · {mergeSource.baseOvr} · {mergeSource.basePosition}
                </span>{" "}
                <span className="text-slate-400">({mergeSource.programPromo})</span>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchMergeTargets(mergeSource, mergeTargetQuery);
                }}
                className="grid grid-cols-[1fr_auto] items-end gap-3"
              >
                <label className="text-xs text-slate-300">
                  Search target card
                  <input
                    type="search"
                    value={mergeTargetQuery}
                    onChange={(event) => setMergeTargetQuery(event.target.value)}
                    placeholder='Try "Raul 115" or "Glorious Eras"'
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={mergeActionState !== "idle"}
                  className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {mergeActionState === "loading-targets" ? "Searching..." : "Search"}
                </button>
              </form>

              <div className="mt-3 space-y-2">
                {mergeTargetRows.length === 0 && (
                  <p className="text-xs text-slate-400">
                    No active target cards found for this query.
                  </p>
                )}
                {mergeTargetRows.map((target) => (
                  <label
                    key={target.playerId}
                    className={[
                      "flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs transition",
                      target.playerId === mergeTargetId
                        ? "border-lime-300/35 bg-lime-300/12 text-lime-100"
                        : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <div>
                      <p className="font-semibold">
                        {target.playerName} · {target.baseOvr} · {target.basePosition}
                      </p>
                      <p className="text-slate-400">
                        {target.programPromo} · Mentions {target.mentionCount}
                      </p>
                    </div>
                    <input
                      type="radio"
                      name="merge-target-card"
                      checked={target.playerId === mergeTargetId}
                      onChange={() => {
                        setMergeTargetId(target.playerId);
                        setMergePreview(null);
                      }}
                    />
                  </label>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={!mergeTargetId || mergeActionState !== "idle"}
                  onClick={() => void previewMerge()}
                  className="rounded-xl border border-lime-300/35 bg-lime-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-lime-200 transition hover:bg-lime-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {mergeActionState === "previewing" ? "Previewing..." : "Preview Merge"}
                </button>
                <button
                  type="button"
                  disabled={!mergePreview || mergeActionState !== "idle"}
                  onClick={() => void executeMerge()}
                  className="rounded-xl border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {mergeActionState === "merging"
                    ? "Merging..."
                    : "Merge + Archive Source"}
                </button>
              </div>

              {mergePreview && selectedMergeTarget && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-200">
                  <p className="mb-2 font-semibold text-slate-100">
                    Preview: {mergeSource.playerName} to {selectedMergeTarget.playerName}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <p>
                      Mentions to move:{" "}
                      <span className="font-semibold text-lime-200">
                        {mergePreview.sourceCounts.mentionsToMove}
                      </span>
                    </p>
                    <p>
                      Mention conflicts:{" "}
                      <span className="font-semibold text-amber-100">
                        {mergePreview.sourceCounts.mentionConflicts}
                      </span>
                    </p>
                    <p>
                      User reviews:{" "}
                      <span className="font-semibold text-lime-200">
                        {mergePreview.sourceCounts.userReviewsTotal}
                      </span>
                    </p>
                    <p>
                      Pending reviews:{" "}
                      <span className="font-semibold text-amber-100">
                        {mergePreview.sourceCounts.userReviewsPending}
                      </span>
                    </p>
                    <p>
                      Aliases to move:{" "}
                      <span className="font-semibold text-lime-200">
                        {mergePreview.sourceCounts.aliasesToMove}
                      </span>
                    </p>
                    <p>
                      Alias conflicts:{" "}
                      <span className="font-semibold text-amber-100">
                        {mergePreview.sourceCounts.aliasConflicts}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </section>
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
            const isBusy = actionState === "saving" || actionState === "deleting";
            const normalizedBasePosition = draft
              ? normalizePositionInput(draft.basePosition)
              : "";
            const hasKnownBasePosition =
              normalizedBasePosition.length > 0 &&
              REVIEW_POSITION_OPTIONS.includes(normalizedBasePosition);
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
                      <Link
                        href={`/player/${row.playerId}`}
                        className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200 transition hover:bg-white/10"
                      >
                        View Card
                      </Link>
                      <Link
                        href={{
                          pathname: "/admin/imports",
                          query: {
                            playerId: row.playerId,
                            playerName: row.playerName,
                            baseOvr: String(row.baseOvr),
                            basePosition: row.basePosition,
                            programPromo: row.programPromo,
                          },
                        }}
                        className="rounded-xl border border-sky-300/35 bg-sky-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-sky-100 transition hover:bg-sky-300/20"
                      >
                        Import Reddit
                      </Link>
                      <button
                        type="button"
                        onClick={() => void openMergePanel(row)}
                        className="rounded-xl border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/20"
                      >
                        Merge
                      </button>
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
                        <select
                          value={
                            hasKnownBasePosition
                              ? normalizedBasePosition
                              : normalizedBasePosition
                                ? normalizedBasePosition
                                : ""
                          }
                          onChange={(event) =>
                            updateDraft(row.playerId, {
                              basePosition: normalizePositionInput(event.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm uppercase text-slate-100 outline-none"
                        >
                          <option value="" disabled className="bg-slate-900 text-slate-300">
                            Select position
                          </option>
                          {!hasKnownBasePosition && normalizedBasePosition && (
                            <option value={normalizedBasePosition} className="bg-slate-900 text-slate-100">
                              {normalizedBasePosition} (current)
                            </option>
                          )}
                          <optgroup label="Attacker">
                            {REVIEW_POSITIONS_BY_GROUP.attacker.map((position) => (
                              <option
                                key={position}
                                value={position}
                                className="bg-slate-900 text-slate-100"
                              >
                                {position}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Midfielder">
                            {REVIEW_POSITIONS_BY_GROUP.midfielder.map((position) => (
                              <option
                                key={position}
                                value={position}
                                className="bg-slate-900 text-slate-100"
                              >
                                {position}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Defender">
                            {REVIEW_POSITIONS_BY_GROUP.defender.map((position) => (
                              <option
                                key={position}
                                value={position}
                                className="bg-slate-900 text-slate-100"
                              >
                                {position}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Goalkeeper">
                            {REVIEW_POSITIONS_BY_GROUP.goalkeeper.map((position) => (
                              <option
                                key={position}
                                value={position}
                                className="bg-slate-900 text-slate-100"
                              >
                                {position}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                      <label className="text-xs text-slate-300">
                        Event/Program (optional)
                        <input
                          type="text"
                          value={draft.programPromo}
                          onChange={(event) =>
                            updateDraft(row.playerId, { programPromo: event.target.value })
                          }
                          list="admin-event-options"
                          maxLength={48}
                          placeholder="Leave blank to use Community"
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
