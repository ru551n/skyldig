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
        <h1 className="text-h1 text-pine font-semibold">{title}</h1>
        {lead && <p className="text-lead text-pine-soft mt-1 max-w-[65ch]">{lead}</p>}
      </div>
      {right}
    </header>
  );
}
