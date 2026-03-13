import Link from "next/link";

type AdminSection = "moderation" | "players" | "imports";

const ADMIN_NAV_ITEMS: Array<{ id: AdminSection; label: string; href: string }> = [
  { id: "moderation", label: "Moderation", href: "/admin/moderation" },
  { id: "players", label: "Players", href: "/admin/players" },
  { id: "imports", label: "Imports", href: "/admin/imports" },
];

type AdminToolsNavProps = {
  active: AdminSection;
  className?: string;
};

export function AdminToolsNav({
  active,
  className = "mb-5",
}: AdminToolsNavProps) {
  return (
    <nav className={`flex gap-2 ${className}`} aria-label="Admin tools">
      {ADMIN_NAV_ITEMS.map((item) =>
        item.id === active ? (
          <span
            key={item.id}
            className="rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            {item.label}
          </span>
        ) : (
          <Link
            key={item.id}
            href={item.href}
            className="rounded-full bg-[var(--bg-pill)] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
          >
            {item.label}
          </Link>
        )
      )}
    </nav>
  );
}
