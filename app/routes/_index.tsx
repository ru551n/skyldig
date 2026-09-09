import { Link } from "react-router";

import { listGrants } from "@server/modules/auth/browser-session.ts";
import { resolveBrowserSession } from "@server/modules/auth/session-auth.ts";

import { ButtonLink, Card, Pill } from "~/components/ui/index.ts";
import { getConfig, getDb } from "~/lib/session-context.server.ts";
import { formatExpiryShort } from "~/lib/format.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/_index";

interface GroupSummary {
  publicId: string;
  name: string;
  role: "member" | "admin";
  expiresAt: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const resolved = await resolveBrowserSession(db, request, config);
  if (!resolved) {
    return { groups: [] as GroupSummary[] };
  }
  const grants = await listGrants(db, resolved.browserSession.id);
  const groups: GroupSummary[] = grants.map((g) => ({
    publicId: g.sessionPublicId,
    name: g.sessionName,
    role: g.role,
    expiresAt: g.expiresAt.toISOString(),
  }));
  return { groups };
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Skyldig" }, { name: "description", content: "Dela utgifter enkelt, utan konto." }];
}

/** A small static example of the settle-up row motif, used as the hero illustration. */
function HeroExample() {
  return (
    <Card tinted className="rounded-row">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-body font-medium text-pine">
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
        <span className="tabular text-lead font-semibold text-pine">300 kr</span>
      </div>
    </Card>
  );
}

export default function LandingPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { groups } = loaderData;

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-8 p-6 pb-16">
      <header className="flex flex-col gap-6 pt-8">
        <div>
          <h1 className="text-h1 font-semibold text-pine">{t("landing.title")}</h1>
          <p className="mt-2 max-w-[65ch] text-lead text-pine-soft">{t("landing.lead")}</p>
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
      </header>

      {groups.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-h2 font-semibold text-pine">{t("landing.yourSessions")}</h2>
          <ul className="flex flex-col gap-2">
            {groups.map((group) => (
              <li key={group.publicId}>
                <Link
                  to={`/s/${group.publicId}`}
                  className="flex items-center justify-between gap-4 rounded-card border border-line bg-paper p-4 hover:bg-frost focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"
                >
                  <span className="text-body font-medium text-pine">{group.name}</span>
                  <Pill>{t("admin.expiresLabel", { date: formatExpiryShort(group.expiresAt) })}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
