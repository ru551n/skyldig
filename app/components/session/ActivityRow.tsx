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
        <span className="truncate text-body font-medium text-pine">
          {item.title}
          {item.deleted && <span className="ml-2 text-meta font-medium text-rust">Borttagen</span>}
          {item.action === "updated" && !item.deleted && (
            <span className="ml-2 text-meta font-medium text-pine-soft">Ändrad</span>
          )}
        </span>
        <span className="truncate text-meta text-pine-soft">{item.personLine}</span>
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
      className="block rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"
    >
      {content}
    </Link>
  );
}
