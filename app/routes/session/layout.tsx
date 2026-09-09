import { useState } from "react";
import { Form, isRouteErrorResponse, Link, Outlet, useLocation, useNavigation } from "react-router";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { getSessionBalances } from "@server/modules/balances/balances.ts";
import { listParticipants } from "@server/modules/participants/participants.ts";

import { ActionBar, ButtonLink, ConfirmDialog, Pill } from "~/components/ui/index.ts";
import { InviteDialog } from "~/components/session/InviteDialog.tsx";
import { SessionRail, type NavItem } from "~/components/session/SessionRail.tsx";
import { isExpiringSoon, type SessionLayoutData } from "~/components/session/types.ts";
import { getConfig, getDb } from "~/lib/session-context.server.ts";
import { formatExpiryShort } from "~/lib/format.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/layout";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid!);

  const [participantRows, sessionBalances] = await Promise.all([
    listParticipants(db, access.session.id),
    getSessionBalances(db, { id: access.session.id, baseCurrency: access.session.baseCurrency }),
  ]);

  const result: SessionLayoutData = {
    session: {
      publicId: access.session.publicId,
      name: access.session.name,
      baseCurrency: access.session.baseCurrency,
      expiresAt: access.session.expiresAt.toISOString(),
    },
    role: access.grant.role,
    participants: participantRows.map((p) => ({
      publicId: p.publicId,
      displayName: p.displayName,
      position: p.position,
    })),
    balances: {
      baseCurrency: sessionBalances.baseCurrency,
      balances: sessionBalances.balances.map((b) => ({
        publicId: b.publicId,
        displayName: b.displayName,
        paid: b.paid.toString(),
        share: b.share.toString(),
        repaid: b.repaid.toString(),
        received: b.received.toString(),
        net: b.net.toString(),
      })),
      transfers: sessionBalances.transfers.map((t) => ({
        from: t.from,
        to: t.to,
        amountMinor: t.amountMinor.toString(),
      })),
    },
  };

  return result;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.session.name} — Skyldig` : "Skyldig" }];
}


/** True on the expense/payment form sub-routes, where the bottom action bar is redundant. */
function isFormRoute(pathname: string): boolean {
  return /\/(ny|andra)$/.test(pathname);
}

export default function SessionLayout({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const location = useLocation();
  const navigation = useNavigation();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { session, role, participants, balances } = loaderData;
  const expiringSoon = isExpiringSoon(session.expiresAt);
  const isSubRoute = location.pathname !== `/s/${session.publicId}`;
  const showActionBar = !isFormRoute(location.pathname);
  const leaving = navigation.formAction === `/s/${session.publicId}/lamna`;

  const navItems: NavItem[] = [
    { to: `/s/${session.publicId}`, label: t("dashboard.nav.overview"), end: true },
    { to: `/s/${session.publicId}/aktivitet`, label: t("dashboard.nav.activity") },
    { to: `/s/${session.publicId}/gor-upp`, label: t("dashboard.nav.settle") },
    { to: `/s/${session.publicId}/deltagare`, label: t("dashboard.nav.participants") },
    ...(role === "admin"
      ? [{ to: `/s/${session.publicId}/admin`, label: t("dashboard.nav.admin") }]
      : []),
  ];

  return (
    <div className="bg-frost min-h-screen">
      <div className="flex flex-col min-[880px]:mx-auto min-[880px]:max-w-[1100px] min-[880px]:flex-row">
        <header className="border-line bg-frost/95 sticky top-0 z-20 flex items-center gap-3 border-b p-4 backdrop-blur min-[880px]:hidden">
          {isSubRoute && (
            <Link
              to={`/s/${session.publicId}`}
              aria-label={t("common.back")}
              className="rounded-control text-pine hover:bg-frost focus-visible:outline-pine flex h-11 w-11 shrink-0 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
                <path
                  d="M12 4l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          )}
          <Link
            to={`/s/${session.publicId}`}
            className="text-lead text-pine min-w-0 flex-1 truncate font-semibold"
          >
            {session.name}
          </Link>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            aria-label={t("invite.action")}
            className="rounded-control text-pine hover:bg-frost focus-visible:outline-pine flex h-11 w-11 shrink-0 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="3"
                width="6"
                height="6"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="11"
                y="3"
                width="6"
                height="6"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="3"
                y="11"
                width="6"
                height="6"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect x="13" y="13" width="2" height="2" fill="currentColor" />
              <rect
                x="17"
                y="13"
                width="0.01"
                height="0.01"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <rect
                x="13"
                y="17"
                width="0.01"
                height="0.01"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M15 11v2M17 15h2M11 15h2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <Pill variant={expiringSoon ? "warning" : "neutral"} className="shrink-0">
            {t("admin.expiresLabel", { date: formatExpiryShort(session.expiresAt) })}
          </Pill>
        </header>

        <nav
          aria-label={session.name}
          className="min-[880px]:border-line hidden min-[880px]:sticky min-[880px]:top-0 min-[880px]:block min-[880px]:h-screen min-[880px]:w-[300px] min-[880px]:shrink-0 min-[880px]:overflow-y-auto min-[880px]:border-r"
        >
          <SessionRail
            sessionName={session.name}
            sessionPublicId={session.publicId}
            expiresAt={session.expiresAt}
            expiringSoon={expiringSoon}
            participants={participants}
            balances={balances.balances}
            baseCurrency={balances.baseCurrency}
            navItems={navItems}
            onInviteClick={() => setInviteOpen(true)}
            onLeaveClick={() => setLeaveOpen(true)}
          />
        </nav>

        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pt-4 pb-8 min-[880px]:max-w-[720px] min-[880px]:px-8 min-[880px]:pt-8"
        >
          <Outlet />
        </main>
      </div>

      {showActionBar && (
        <ActionBar className="mx-auto min-[880px]:hidden">
          <ButtonLink to={`/s/${session.publicId}/utgifter/ny`} fullWidth>
            {t("dashboard.actions.newExpense")}
          </ButtonLink>
          <ButtonLink to={`/s/${session.publicId}/betalningar/ny`} variant="secondary" fullWidth>
            {t("dashboard.actions.newPayment")}
          </ButtonLink>
          <ButtonLink to={`/s/${session.publicId}/deltagare`} variant="secondary" fullWidth>
            {t("dashboard.actions.newParticipant")}
          </ButtonLink>
        </ActionBar>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        action={`/s/${session.publicId}/bjud-in`}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t("common.leaveConfirmTitle")}
        body={t("common.leaveConfirmBody")}
        confirmLabel={t("common.leaveGroup")}
        destructive
        pending={leaving}
        onConfirm={() => {
          const form = document.getElementById("leave-form") as HTMLFormElement | null;
          form?.requestSubmit();
        }}
      />
      <Form
        id="leave-form"
        method="post"
        action={`/s/${session.publicId}/lamna`}
        className="hidden"
        aria-hidden
      />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="bg-frost text-pine mx-auto flex min-h-screen max-w-[65ch] flex-col items-start justify-center gap-4 p-6"
    >
      <h1 className="text-h1 font-semibold">Något gick fel</h1>
      <p className="text-body text-pine-soft">
        {notFound
          ? "Gruppen finns inte, eller så har du inte tillgång till den."
          : "Ett oväntat fel inträffade. Försök igen om en stund."}
      </p>
      <Link to="/" className="rounded-control bg-pine text-body text-paper px-4 py-2 font-medium">
        Till startsidan
      </Link>
    </main>
  );
}
