import { Link } from "react-router";

import { Money, Row } from "~/components/ui/index.ts";

import { formatTime, type ActivityDisplayItem } from "./activity.ts";

export interface ActivityRowProps {
  item: ActivityDisplayItem;
  currency: string;
}

/** One row in the activity feed. Deleted items are muted, unlinked, and marked "Borttagen". */
export function ActivityRow({ item, currency }: ActivityRowProps) {
  const content = (
    <Row className={item.deleted ? "opacity-60" : undefined}>
      <div className="flex min-w-0 flex-col">
        <span className="text-body text-pine truncate font-medium">
          {item.title}
          {item.deleted && <span className="text-meta text-rust ml-2 font-medium">Borttagen</span>}
          {item.action === "updated" && !item.deleted && (
            <span className="text-meta text-pine-soft ml-2 font-medium">Ändrad</span>
          )}
        </span>
        <span className="text-meta text-pine-soft truncate">{item.personLine}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money amountMinor={item.amountMinor} currency={currency} size="body" />
        <span className="text-meta text-pine-soft">{formatTime(item.createdAt)}</span>
      </div>
    </Row>
  );

  if (!item.href) {
    return content;
  }

  return (
    <Link
      to={item.href}
      className="rounded-control focus-visible:outline-pine block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {content}
    </Link>
  );
}
