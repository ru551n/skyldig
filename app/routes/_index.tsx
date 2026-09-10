import { Link } from "react-router";

import { listGrants } from "@server/modules/auth/browser-session.ts";
import { resolveBrowserSession } from "@server/modules/auth/session-auth.ts";

import { ButtonLink, Card, Logo } from "~/components/ui/index.ts";
import { LocaleSwitcher } from "~/components/i18n/LocaleSwitcher.tsx";
import { GroupList, type GroupSummary } from "~/components/session/GroupList.tsx";
import { getConfig, getDb } from "~/lib/session-context.server.ts";
import { localeFromMatches, t, useT } from "~/i18n";

import type { Route } from "./+types/_index";


export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const resolved = await resolveBrowserSession(db, request, config);
  const left = new URL(request.url).searchParams.get("lamnad") === "1";
  if (!resolved) {
    return { groups: [] as GroupSummary[], left };
  }
  const grants = await listGrants(db, resolved.browserSession.id);
  const groups: GroupSummary[] = grants.map((g) => ({
    publicId: g.sessionPublicId,
    name: g.sessionName,
    expiresAt: g.expiresAt.toISOString(),
  }));
  return { groups, left };
}

export function meta({ matches }: Route.MetaArgs) {
  const locale = localeFromMatches(matches);
  return [
    { title: t(locale, "landing.title") },
    { name: "description", content: t(locale, "landing.lead") },
  ];
}

/** A small static example of the settle-up row motif, used as the hero illustration. */
function HeroExample() {
  return (
    <Card tinted className="rounded-row">
      <div className="flex items-center justify-between gap-4">
        <div className="text-body text-pine flex items-center gap-3 font-medium">
          <span>Peter</span>
          <svg viewBox="0 0 64 16" width="48" height="12" fill="none" aria-hidden="true">
            <line x1="0" y1="8" x2="54" y2="8" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M48 2l8 6-8 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Johan</span>
        </div>
        <span className="tabular text-lead text-pine font-semibold">300 kr</span>
      </div>
    </Card>
  );
}

export default function LandingPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { groups, left } = loaderData;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-8 p-6 pb-16"
    >
      <header className="flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-h1 text-pine flex items-center gap-3 font-semibold">
            <Logo size={36} />
            {t("landing.title")}
          </h1>
          <p className="text-lead text-pine-soft mt-2 max-w-[65ch]">{t("landing.lead")}</p>
        </div>
        <HeroExample />
        <div className="flex flex-col gap-3 min-[480px]:flex-row">
          <ButtonLink to="/new" size="lg" fullWidth>
            {t("landing.createSession")}
          </ButtonLink>
          <ButtonLink to="/join" variant="secondary" size="lg" fullWidth>
            {t("landing.joinSession")}
          </ButtonLink>
        </div>
        <Link
          to="/guide"
          className="text-body text-pine-soft hover:text-pine focus-visible:outline-pine -mx-1 inline-flex min-h-11 w-fit items-center rounded-control px-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t("guide.linkFromLanding")}
        </Link>
      </header>

      {left && (
        <p role="status" className="rounded-card border-line bg-paper text-body text-pine-soft border p-4">
          {t("myGroups.leftNotice")}
        </p>
      )}

      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-pine font-semibold">{t("landing.yourSessions")}</h2>
          <GroupList groups={groups} />
        </section>
      )}

      <footer className="mt-auto flex justify-center pt-8">
        <LocaleSwitcher />
      </footer>
    </main>
  );
}
