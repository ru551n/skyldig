import { NavLink } from "react-router";

import { Avatar, Money, Pill } from "~/components/ui/index.ts";
import { formatExpiryShort } from "~/lib/format.ts";
import { useT } from "~/i18n";

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
  onLeaveClick,
}: SessionRailProps) {
  const t = useT();
  const balanceByPublicId = new Map(balances.map((b) => [b.publicId, b]));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <p className="truncate text-lead font-semibold text-pine" title={sessionName}>
          {sessionName}
        </p>
        <Pill variant={expiringSoon ? "warning" : "neutral"}>
          {t("admin.expiresLabel", { date: formatExpiryShort(expiresAt) })}
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
                  <span className="truncate text-body text-pine">{p.displayName}</span>
                </div>
                {balance && (
                  <Money amountMinor={balance.net} currency={baseCurrency} signed size="body" className="shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <nav aria-label={sessionName} className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `min-h-11 rounded-control px-3 py-2 text-body font-medium ${
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
        className="mt-auto min-h-11 rounded-control px-3 py-2 text-left text-body font-medium text-rust hover:bg-rust/5"
      >
        {t("common.leaveGroup")}
      </button>
    </div>
  );
}
