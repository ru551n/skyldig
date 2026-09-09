import { Form, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { listActivity } from "@server/modules/audit/audit.ts";

import { Button, EmptyState } from "~/components/ui/index.ts";
import { ActivityRow } from "~/components/session/ActivityRow.tsx";
import {
  groupByDay,
  toDisplayItem,
  type SerializedActivityRow,
} from "~/components/session/activity.ts";
import { SESSION_LAYOUT_ROUTE_ID, type SessionLayoutData } from "~/components/session/types.ts";
import { getConfig, getDb } from "~/lib/session-context.server.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/activity";

const PAGE_SIZE = 30;

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid!);

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;

  const rows = await listActivity(db, access.session.id, { limit: PAGE_SIZE + 1, before });
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);

  const items: SerializedActivityRow[] = page.map((a) => ({
    entityType: a.entityType,
    action: a.action,
    revisionNo: a.revisionNo,
    createdAt: a.createdAt.toISOString(),
    snapshot: a.snapshot,
  }));

  const nextBefore = page.length > 0 ? page[page.length - 1]!.createdAt.toISOString() : null;

  return { items, hasMore, nextBefore };
}

export function meta() {
  return [{ title: "Aktivitet — Skyldig" }];
}

export default function Activity({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const layoutData = useRouteLoaderData(SESSION_LAYOUT_ROUTE_ID) as SessionLayoutData;
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const { items, hasMore, nextBefore } = loaderData;

  const displayItems = items.map((row, index) => toDisplayItem(row, index));
  const groups = groupByDay(displayItems);
  const loadingMore =
    navigation.state === "loading" && navigation.location?.search.includes("before=");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1 text-pine font-semibold">{t("activity.title")}</h1>
        <p className="text-body text-pine-soft mt-1">{t("activity.lead")}</p>
      </div>

      {displayItems.length === 0 ? (
        <EmptyState headline={t("activity.title")} body={t("activity.empty")} />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.heading} className="flex flex-col gap-2">
              <h2 className="text-meta text-pine-soft font-semibold tracking-wide uppercase">
                {group.heading}
              </h2>
              <div className="rounded-card border-line bg-paper border px-4">
                {group.items.map((item) => (
                  <ActivityRow
                    key={item.key}
                    item={item}
                    currency={layoutData.balances.baseCurrency}
                  />
                ))}
              </div>
            </section>
          ))}

          {hasMore && nextBefore && (
            <Form method="get" className="self-start">
              {Array.from(searchParams.entries())
                .filter(([key]) => key !== "before")
                .map(([key, value]) => (
                  <input key={key} type="hidden" name={key} value={value} />
                ))}
              <input type="hidden" name="before" value={nextBefore} />
              <Button type="submit" variant="secondary" loading={loadingMore}>
                {t("common.showMore")}
              </Button>
            </Form>
          )}
        </>
      )}
    </div>
  );
}
