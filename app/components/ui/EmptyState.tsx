export interface EmptyStateProps {
  headline: string;
  body: string;
  action?: React.ReactNode;
}

/** Headline + body + optional action, for empty lists. */
export function EmptyState({ headline, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-line bg-paper p-6">
      <p className="text-lead font-semibold text-pine">{headline}</p>
      <p className="text-body text-pine-soft">{body}</p>
      {action}
    </div>
  );
}
