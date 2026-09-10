import { motion } from "motion/react";
import { Link } from "react-router";

import { Arrow, Card, Money } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

export interface SettleRowProps {
  from: string;
  to: string;
  amountMinor: string;
  currency: string;
  /** Stagger index for the once-on-mount entrance (60ms apart, 240ms, ease-out). */
  index?: number;
  /**
   * When given, the whole row links here (the prefilled payment form) and shows a "Markera
   * betald" hint under the amount: one tap to settle this transfer, one more to save it.
   */
  href?: string;
}

/** The settle-up row motif: two names, an arrow, the amount, on a sol tint. */
export function SettleRow({ from, to, amountMinor, currency, index = 0, href }: SettleRowProps) {
  const t = useT();
  const content = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/*
        The arrow is decorative, so the direction of the payment is spelled out for
        screen readers: without it the row reads as two bare names and an amount.
      */}
      <p className="text-body text-pine flex min-w-0 items-center gap-3 font-medium">
        <span className="truncate">{from}</span>
        <span className="sr-only"> {t("settle.payConnector")} </span>
        <Arrow className="text-pine-soft shrink-0" aria-hidden />
        <span className="truncate">{to}</span>
      </p>
      <div className="flex flex-col items-end gap-1">
        <Money amountMinor={amountMinor} currency={currency} size="lead" />
        {href && (
          <span className="text-meta text-pine font-medium underline underline-offset-2">
            {t("settle.markPaid")} <span aria-hidden>›</span>
          </span>
        )}
      </div>
    </div>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: index * 0.06, ease: "easeOut" }}
    >
      {href ? (
        <Link
          to={href}
          className="rounded-row focus-visible:outline-pine block transition-[filter] hover:brightness-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Card tinted className="rounded-row">
            {content}
          </Card>
        </Link>
      ) : (
        <Card tinted className="rounded-row">
          {content}
        </Card>
      )}
    </motion.div>
  );
}
