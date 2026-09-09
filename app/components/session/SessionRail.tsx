import { NavLink } from "react-router";

import { Avatar, Logo, Money, Pill } from "~/components/ui/index.ts";
import { LocaleSwitcher } from "~/components/i18n/LocaleSwitcher.tsx";
import { formatExpiryShort } from "~/lib/format.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import type { LayoutBalanceEntry, LayoutParticipant } from "./types.ts";

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export interface SessionRailProps {
  sessionName: string;
  sessionPublicId: string;
  expiresAt: string;
  expiringSoon: boolean;
  participants: LayoutParticipant[];
  balances: LayoutBalanceEntry[];
  baseCurrency: string;
  navItems: NavItem[];
  onInviteClick: () => void;
  onLeaveClick: () => void;
}

/** Desktop-only (≥880px) sticky left rail: group identity, participant balances, and nav. */
export function SessionRail({
  sessionName,
  expiresAt,
  expiringSoon,
  participants,
  balances,
  baseCurrency,
  navItems,
  onInviteClick,
  onLeaveClick,
}: SessionRailProps) {
  const t = useT();
  const locale = useLocale();
  const balanceByPublicId = new Map(balances.map((b) => [b.publicId, b]));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <p
          className="text-lead text-pine flex min-w-0 items-center gap-2 truncate font-semibold"
          title={sessionName}
        >
          <Logo size={22} className="shrink-0" />
          <span className="truncate">{sessionName}</span>
        </p>
        <Pill variant={expiringSoon ? "warning" : "neutral"}>
          {t("admin.expiresLabel", { date: formatExpiryShort(expiresAt, toIntlLocale(locale)) })}
        </Pill>
      </div>

      {participants.length > 0 && (
        <ul className="flex flex-col gap-3">
          {participants.map((p, i) => {
            const balance = balanceByPublicId.get(p.publicId);
            return (
              <li key={p.publicId} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={p.displayName} position={i} />
                  <span className="text-body text-pine truncate">{p.displayName}</span>
                </div>
                {balance && (
                  <Money
                    amountMinor={balance.net}
                    currency={baseCurrency}
                    signed
                    size="body"
                    className="shrink-0"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onInviteClick}
        className="rounded-control bg-pine text-body text-paper min-h-11 px-3 py-2 text-left font-medium"
      >
        {t("invite.action")}
      </button>

      <nav aria-label={sessionName} className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-control text-body min-h-11 px-3 py-2 font-medium ${
                isActive ? "bg-frost text-pine" : "text-pine-soft hover:bg-frost hover:text-pine"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={onLeaveClick}
        className="rounded-control text-body text-rust hover:bg-rust/5 mt-auto min-h-11 px-3 py-2 text-left font-medium"
      >
        {t("common.leaveGroup")}
      </button>

      <LocaleSwitcher className="px-3" />
    </div>
  );
}
