import Link from "next/link";

export function LegalFooter() {
  return (
    <footer className="mt-8 border-t border-white/10 pt-4 text-xs text-slate-400">
      <p>FC Mobile Reviews is an independent fan project, not affiliated with EA SPORTS.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link href="/terms" className="text-slate-300 hover:text-slate-100">
          Terms
        </Link>
        <Link href="/privacy" className="text-slate-300 hover:text-slate-100">
          Privacy
        </Link>
        <Link href="/feed.xml" className="text-slate-300 hover:text-slate-100">
          RSS
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
        <Link href="/top/attacker" className="text-slate-400 hover:text-slate-200">
          Top Attackers
        </Link>
        <Link href="/top/midfielder" className="text-slate-400 hover:text-slate-200">
          Top Midfielders
        </Link>
        <Link href="/top/defender" className="text-slate-400 hover:text-slate-200">
          Top Defenders
        </Link>
        <Link href="/top/goalkeeper" className="text-slate-400 hover:text-slate-200">
          Top Goalkeepers
        </Link>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Source content is attributed to platform links when available. Rights remain
        with original authors and platforms.
      </p>
    </footer>
  );
}
