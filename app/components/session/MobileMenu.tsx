import { useEffect, useState } from "react";
import { NavLink } from "react-router";

import { Button, Dialog, Pill } from "~/components/ui/index.ts";
import { formatExpiryShort } from "~/lib/format.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import type { NavItem } from "./SessionRail.tsx";

export interface MobileMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navItems: NavItem[];
  expiresAt: string;
  expiringSoon: boolean;
  /** Submits the layout's hidden leave form. */
  onLeave: () => void;
  leaving: boolean;
}

/**
 * The phone counterpart of the side rail, which is hidden below 880px: every group page
 * (including Admin), the expiry date, and leaving the group. Confirming a leave happens inside
 * this same dialog rather than in a second one stacked on top, so focus never has to be handed
 * between two closing/opening dialogs.
 */
export function MobileMenu({
  open,
  onOpenChange,
  navItems,
  expiresAt,
  expiringSoon,
  onLeave,
  leaving,
}: MobileMenuProps) {
  const t = useT();
  const locale = useLocale();
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  useEffect(() => {
    if (open) setConfirmingLeave(false);
  }, [open]);

  if (confirmingLeave) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("common.leaveConfirmTitle")}
        description={t("common.leaveConfirmBody")}
      >
        <div className="flex flex-col gap-2">
          <Button variant="danger" fullWidth disabled={leaving} onClick={onLeave}>
            {t("common.leaveGroup")}
          </Button>
          <Button variant="secondary" fullWidth autoFocus onClick={() => setConfirmingLeave(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("common.menu")}>
      <nav aria-label={t("common.menu")} className="flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => onOpenChange(false)}
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
      <div className="border-line mt-3 flex flex-col items-start gap-3 border-t pt-4">
        <NavLink
          to="/mina-grupper"
          onClick={() => onOpenChange(false)}
          className="rounded-control text-body text-pine-soft hover:bg-frost hover:text-pine min-h-11 w-full px-3 py-2 font-medium"
        >
          {t("myGroups.title")}
        </NavLink>
        <Pill variant={expiringSoon ? "warning" : "neutral"}>
          {t("admin.expiresLabel", { date: formatExpiryShort(expiresAt, toIntlLocale(locale)) })}
        </Pill>
        <button
          type="button"
          onClick={() => setConfirmingLeave(true)}
          className="rounded-control text-body text-rust hover:bg-frost focus-visible:outline-pine min-h-11 px-3 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t("common.leaveGroup")}
        </button>
      </div>
    </Dialog>
  );
}
