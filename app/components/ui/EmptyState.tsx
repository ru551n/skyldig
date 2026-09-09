export interface EmptyStateProps {
  headline: string;
  body: string;
  action?: React.ReactNode;
}

/** Headline + body + optional action, for empty lists. */
export function EmptyState({ headline, body, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border-line bg-paper flex flex-col items-start gap-3 border p-6">
      <p className="text-lead text-pine font-semibold">{headline}</p>
      <p className="text-body text-pine-soft">{body}</p>
      {action}
    </div>
  );
}
