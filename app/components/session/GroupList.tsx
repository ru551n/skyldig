import { Link } from "react-router";

import { Button, Pill } from "~/components/ui/index.ts";
import { formatExpiryShort } from "~/lib/format.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

export interface GroupSummary {
  publicId: string;
  name: string;
  expiresAt: string;
}

export interface GroupListProps {
  groups: GroupSummary[];
  /** When given, each row gets a Lämna button that calls this (the caller confirms first). */
  onLeave?: (group: GroupSummary) => void;
}

/** The groups this browser holds access to, each linking into the group. */
export function GroupList({ groups, onLeave }: GroupListProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <ul className="flex flex-col gap-2">
      {groups.map((group) => (
        <li key={group.publicId} className="flex items-stretch gap-2">
          <Link
            to={`/s/${group.publicId}`}
            className="rounded-card border-line bg-paper hover:bg-frost focus-visible:outline-pine flex min-w-0 flex-1 items-center justify-between gap-4 border p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="text-body text-pine truncate font-medium">{group.name}</span>
            <Pill className="shrink-0">
              {t("admin.expiresLabel", { date: formatExpiryShort(group.expiresAt, toIntlLocale(locale)) })}
            </Pill>
          </Link>
          {onLeave && (
            <Button
              variant="secondary"
              className="text-rust h-auto shrink-0"
              aria-label={t("myGroups.leaveLabel", { name: group.name })}
              onClick={() => onLeave(group)}
            >
              {t("myGroups.leave")}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
