import type { FormEvent } from "react";
import { AdminPageHeader } from "@/components/admin-page-header";

type AdminAuthShellProps = {
  title: string;
  description: string;
  status: "checking" | "unauthenticated";
  error?: string | null;
  flash?: string | null;
  loginEmail: string;
  loginPassword: string;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isLoggingIn: boolean;
  signInDescription: string;
  loadingMessage?: string;
};

export function AdminAuthShell({
  title,
  description,
  status,
  error,
  flash,
  loginEmail,
  loginPassword,
  onLoginEmailChange,
  onLoginPasswordChange,
  onSubmit,
  isLoggingIn,
  signInDescription,
  loadingMessage = "Checking admin session...",
}: AdminAuthShellProps) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <AdminPageHeader title={title} description={description} />

      {error && (
        <div className="mb-4 rounded-2xl border border-rose-300/35 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {flash && (
        <div className="mb-4 rounded-2xl border border-lime-300/35 bg-lime-300/10 px-4 py-3 text-sm text-lime-100">
          {flash}
        </div>
      )}

      {status === "checking" && (
        <div className="glass-panel rounded-2xl px-4 py-5 text-sm text-slate-300">
          {loadingMessage}
        </div>
      )}

      {status === "unauthenticated" && (
        <section className="glass-panel mb-5 rounded-2xl p-4">
          <h2 className="mb-2 text-xl font-semibold text-slate-100">Admin Sign In</h2>
          <p className="mb-4 text-sm text-slate-400">{signInDescription}</p>
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block text-xs text-slate-300">
              Email
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => onLoginEmailChange(event.target.value)}
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
                onChange={(event) => onLoginPasswordChange(event.target.value)}
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
    </main>
  );
}
