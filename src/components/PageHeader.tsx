export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-header mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-bold text-stone-950">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function PlaceholderCard({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-stone-300 bg-white px-6 py-16 text-center text-sm text-stone-400">
      {text}
    </div>
  );
}
