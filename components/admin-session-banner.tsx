type AdminSessionBannerProps = {
  adminEmail: string | null;
  onLogout: () => void;
  className?: string;
};

export function AdminSessionBanner({
  adminEmail,
  onLogout,
  className = "mb-5",
}: AdminSessionBannerProps) {
  return (
    <section className={`glass-panel flex items-center justify-between gap-3 rounded-2xl p-4 ${className}`}>
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
  );
}
