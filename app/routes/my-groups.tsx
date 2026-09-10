import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";

import { listGrants } from "@server/modules/auth/browser-session.ts";
import { resolveBrowserSession } from "@server/modules/auth/session-auth.ts";

import { GroupList, type GroupSummary } from "~/components/session/GroupList.tsx";
import { ButtonLink, ConfirmDialog, EmptyState, PageHeader } from "~/components/ui/index.ts";
import { getConfig, getDb } from "~/lib/session-context.server.ts";
import { localeFromMatches, t as translate, useT } from "~/i18n";

import type { Route } from "./+types/my-groups";

/**
 * Every group this browser holds access to. There are no accounts, so "my groups" means the
 * grants attached to this browser's session cookie — another browser or device has its own list.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const left = new URL(request.url).searchParams.get("lamnad") === "1";
  const resolved = await resolveBrowserSession(getDb(), request, getConfig());
  if (!resolved) return { groups: [] as GroupSummary[], left };
  const grants = await listGrants(getDb(), resolved.browserSession.id);
  const groups: GroupSummary[] = grants
    .map((g) => ({ publicId: g.sessionPublicId, name: g.sessionName, expiresAt: g.expiresAt.toISOString() }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
  return { groups, left };
}

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${translate(localeFromMatches(matches), "myGroups.title")} — Skyldig` }];
}

export default function MyGroups({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const [leaving, setLeaving] = useState<GroupSummary | null>(null);
  const { groups, left } = loaderData;

  // Leaving redirects back to this same route, so the component (and this state) survives;
  // close the dialog once fresh data arrives rather than leaving it open over the new list.
  useEffect(() => {
    setLeaving(null);
  }, [loaderData]);

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16">
      <PageHeader title={t("myGroups.title")} lead={t("myGroups.lead")} />

      {left && (
        <p role="status" className="rounded-card border-line bg-paper text-body text-pine-soft border p-4">
          {t("myGroups.leftNotice")}
        </p>
      )}

      {groups.length > 0 ? (
        <GroupList groups={groups} onLeave={setLeaving} />
      ) : (
        <EmptyState headline={t("myGroups.emptyHeadline")} body={t("myGroups.emptyBody")} />
      )}

      <div className="flex flex-col gap-3 min-[480px]:flex-row">
        <ButtonLink to="/new" fullWidth>
          {t("landing.createSession")}
        </ButtonLink>
        <ButtonLink to="/join" variant="secondary" fullWidth>
          {t("landing.joinSession")}
        </ButtonLink>
      </div>

      {/* Posts to the group's own leave route, which revokes this browser's access and — given
          returnTo — redirects back here. */}
      <Form
        id="my-groups-leave-form"
        method="post"
        action={leaving ? `/s/${leaving.publicId}/lamna` : undefined}
        hidden
      >
        <input type="hidden" name="returnTo" value="mina-grupper" />
      </Form>
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
        title={leaving ? t("myGroups.leaveConfirmTitle", { name: leaving.name }) : ""}
        body={t("common.leaveConfirmBody")}
        confirmLabel={t("common.leaveGroup")}
        destructive
        pending={navigation.state === "submitting"}
        onConfirm={() => {
          const form = document.getElementById("my-groups-leave-form") as HTMLFormElement | null;
          form?.requestSubmit();
        }}
      />
    </main>
  );
}
