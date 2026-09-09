import { Link, useRouteLoaderData } from "react-router";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { listActivity } from "@server/modules/audit/audit.ts";

import { ButtonLink, EmptyState, Money } from "~/components/ui/index.ts";
import { ActivityRow } from "~/components/session/ActivityRow.tsx";
import { toDisplayItem, type SerializedActivityRow } from "~/components/session/activity.ts";
import { SettleRow } from "~/components/session/SettleRow.tsx";
import { SESSION_LAYOUT_ROUTE_ID, type SessionLayoutData } from "~/components/session/types.ts";
import { getConfig, getDb } from "~/lib/session-context.server.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/dashboard";

const RECENT_LIMIT = 8;
const MAX_VISIBLE_TRANSFERS = 3;

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid!);
  // The dashboard shows recent expenses and repayments, one row per item. The full
  // revision-by-revision feed, including deletions, lives on the activity page. Over-fetch
  // so that collapsing revisions still leaves enough rows to fill the list.
  const activity = await listActivity(db, access.session.id, { limit: RECENT_LIMIT * 4 });

  const seen = new Set<string>();
  const recent: SerializedActivityRow[] = [];
  for (const a of activity) {
    const publicId = (a.snapshot as { publicId?: string } | null)?.publicId;
    // Every snapshot carries a publicId; fall back to the timestamp so a malformed row
    // is still shown rather than silently swallowed.
    const key = `${a.entityType}:${publicId ?? a.createdAt.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (a.action === "deleted") continue;
    recent.push({
      entityType: a.entityType,
      action: a.action,
      revisionNo: a.revisionNo,
      createdAt: a.createdAt.toISOString(),
      snapshot: a.snapshot,
    });
    if (recent.length >= RECENT_LIMIT) break;
  }

  return { recent };
}

export function meta() {
  return [{ title: "Översikt — Skyldig" }];
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const layoutData = useRouteLoaderData(SESSION_LAYOUT_ROUTE_ID) as SessionLayoutData;
  const { session, participants, balances } = layoutData;
  const { recent } = loaderData;

  const totalToSettle = balances.transfers.reduce(
    (sum, transfer) => sum + BigInt(transfer.amountMinor),
    0n,
  );
  const visibleTransfers = balances.transfers.slice(0, MAX_VISIBLE_TRANSFERS);
  const hasMoreTransfers = balances.transfers.length > MAX_VISIBLE_TRANSFERS;

  const recentItems = recent.map((row, index) => toDisplayItem(row, index));

  if (participants.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 text-pine font-semibold">{t("dashboard.title")}</h1>
        <EmptyState
          headline={t("common.noParticipantsHeadline")}
          body={t("common.noParticipantsBody")}
          action={
            <ButtonLink to={`/s/${session.publicId}/deltagare`}>
              {t("common.addParticipantCta")}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  if (balances.transfers.length === 0 && recentItems.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 text-pine font-semibold">{t("dashboard.title")}</h1>
        <EmptyState
          headline={t("dashboard.noExpensesHeadline")}
          body={t("dashboard.noExpenses")}
          action={
            <ButtonLink to={`/s/${session.publicId}/utgifter/ny`}>
              {t("dashboard.actions.newExpense")}
            </ButtonLink>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-h1 text-pine font-semibold">{t("dashboard.title")}</h1>

      {balances.transfers.length === 0 ? (
        <EmptyState headline={t("common.allSettledHeadline")} body={t("dashboard.allSettled")} />
      ) : (
        <section className="flex flex-col gap-4">
          <div>
            <p className="text-body text-pine-soft">{t("dashboard.remainingToSettle")}</p>
            <Money amountMinor={totalToSettle} currency={balances.baseCurrency} size="hero" />
          </div>

          <div className="flex flex-col gap-3">
            {visibleTransfers.map((transfer, index) => (
              <SettleRow
                key={`${transfer.from.publicId}-${transfer.to.publicId}`}
                from={transfer.from.displayName}
                to={transfer.to.displayName}
                amountMinor={transfer.amountMinor}
                currency={balances.baseCurrency}
                index={index}
              />
            ))}
          </div>

          {hasMoreTransfers && (
            <Link
              to={`/s/${session.publicId}/gor-upp`}
              className="text-body text-pine self-start font-medium underline underline-offset-2"
            >
              {t("dashboard.showAllSettle")}
            </Link>
          )}
        </section>
      )}

      {recentItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-h2 text-pine font-semibold">{t("dashboard.recent")}</h2>
          <div className="rounded-card border-line bg-paper border px-4">
            {recentItems.map((item) => (
              <ActivityRow key={item.key} item={item} currency={balances.baseCurrency} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
