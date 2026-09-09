export interface PageHeaderProps {
  title: string;
  lead?: string;
  right?: React.ReactNode;
}

/** h1 + optional lead paragraph + optional right-aligned slot (e.g. a Pill). */
export function PageHeader({ title, lead, right }: PageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-h1 font-semibold text-pine">{title}</h1>
        {lead && <p className="mt-1 max-w-[65ch] text-lead text-pine-soft">{lead}</p>}
      </div>
      {right}
    </header>
  );
}
