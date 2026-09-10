import { Link, useParams } from "react-router";

import { Money, Row } from "~/components/ui/index.ts";
import { useLocale, useT } from "~/i18n";

import { formatTime, type ActivityDisplayItem } from "./activity.ts";

export interface ActivityRowProps {
  item: ActivityDisplayItem;
  currency: string;
}

/** One row in the activity feed. Deleted items are muted, unlinked, and marked as deleted. */
export function ActivityRow({ item, currency }: ActivityRowProps) {
  const t = useT();
  const locale = useLocale();
  // `item.href` (e.g. "utgifter/X") is session-root-relative, not relative to the *current*
  // route — this component is rendered both from the dashboard (session root) and from
  // /aktivitet (one segment deeper), where a plain relative <Link> would resolve underneath
  // /aktivitet instead and 404. Anchor it to the session root explicitly instead.
  const { sid } = useParams();
  const content = (
    <Row className={item.deleted ? "opacity-60" : undefined}>
      <div className="flex min-w-0 flex-col">
        <span className="text-body text-pine truncate font-medium">
          {item.title}
          {item.deleted && (
            <span className="text-meta text-rust ml-2 font-medium">{t("activity.deleted")}</span>
          )}
          {item.action === "updated" && !item.deleted && (
            <span className="text-meta text-pine-soft ml-2 font-medium">{t("activity.edited")}</span>
          )}
        </span>
        <span className="text-meta text-pine-soft truncate">{item.personLine}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money amountMinor={item.amountMinor} currency={currency} size="body" />
        <span className="text-meta text-pine-soft">{formatTime(item.createdAt, locale)}</span>
      </div>
    </Row>
  );

  if (!item.href) {
    return content;
  }

  return (
    <Link
      to={`/s/${sid}/${item.href}`}
      className="rounded-control focus-visible:outline-pine block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {content}
    </Link>
  );
}
