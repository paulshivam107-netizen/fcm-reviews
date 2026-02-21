import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
      >
        Back
      </Link>

      <h1 className="text-2xl font-bold text-slate-100">Terms of Use</h1>
      <p className="mt-2 text-sm text-slate-300">Last updated: February 21, 2026</p>

      <section className="mt-5 space-y-4 text-sm leading-relaxed text-slate-200">
        <p>
          FC Mobile Reviews is an independent community project. We are not affiliated
          with EA SPORTS, FIFA, or their partners.
        </p>
        <p>
          By using this site, you agree to use it lawfully and not submit spam,
          abusive content, or infringing material.
        </p>
        <p>
          User submissions may be moderated, approved, rejected, or removed at our
          discretion to keep the platform useful and safe.
        </p>
        <p>
          Content from external platforms (for example Reddit) is attributed to source
          URLs when available. Ownership remains with original authors/platforms.
        </p>
        <p>
          This service is provided "as is" without warranties. Gameplay opinions are
          subjective and should not be treated as guaranteed outcomes.
        </p>
      </section>
    </main>
  );
}

