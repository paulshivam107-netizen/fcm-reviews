import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-screen-sm px-4 pb-12 pt-7 sm:px-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:bg-white/10"
      >
        Back
      </Link>

      <h1 className="text-2xl font-bold text-slate-100">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-300">Last updated: February 21, 2026</p>

      <section className="mt-5 space-y-4 text-sm leading-relaxed text-slate-200">
        <p>
          We collect limited technical data (for example hashed fingerprint, IP-derived
          signals, and user agent) to prevent spam and enforce submission limits.
        </p>
        <p>
          If you provide a Reddit or in-game username with a review, it may be shown
          publicly with that review after moderation.
        </p>
        <p>
          We store moderation and usage events to improve quality, reliability, and
          abuse prevention. We do not sell personal data.
        </p>
        <p>
          Captcha verification is used to reduce automated abuse. Captcha handling is
          subject to the captcha provider's own terms.
        </p>
        <p>
          For takedown requests or privacy concerns, contact the project operator and
          include the relevant review/player URL.
        </p>
      </section>
    </main>
  );
}

