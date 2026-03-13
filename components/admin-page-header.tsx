type AdminPageHeaderProps = {
  title: string;
  description: string;
  className?: string;
};

export function AdminPageHeader({
  title,
  description,
  className = "mb-5",
}: AdminPageHeaderProps) {
  return (
    <header className={className}>
      <p className="mb-2 inline-flex items-center rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200">
        Admin
      </p>
      <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
      <p className="mt-2 text-sm text-slate-300">{description}</p>
    </header>
  );
}
