import { motion } from "motion/react";

import { Arrow, Card, Money } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

export interface SettleRowProps {
  from: string;
  to: string;
  amountMinor: string;
  currency: string;
  /** Stagger index for the once-on-mount entrance (60ms apart, 240ms, ease-out). */
  index?: number;
  /** Extra content appended after the amount, e.g. a "Registrera betalning" button. */
  action?: React.ReactNode;
}

/** The settle-up row motif: two names, an arrow, the amount, on a sol tint. */
export function SettleRow({ from, to, amountMinor, currency, index = 0, action }: SettleRowProps) {
  const t = useT();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: index * 0.06, ease: "easeOut" }}
    >
      <Card tinted className="rounded-row">
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
          <div className="flex items-center gap-3">
            <Money amountMinor={amountMinor} currency={currency} size="lead" />
            {action}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
