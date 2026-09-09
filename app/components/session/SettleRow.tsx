import { motion } from "motion/react";

import { Arrow, Card, Money } from "~/components/ui/index.ts";

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
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: index * 0.06, ease: "easeOut" }}
    >
      <Card tinted className="rounded-row">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 text-body font-medium text-pine">
            <span className="truncate">{from}</span>
            <Arrow className="shrink-0 text-pine-soft" />
            <span className="truncate">{to}</span>
          </div>
          <div className="flex items-center gap-3">
            <Money amountMinor={amountMinor} currency={currency} size="lead" />
            {action}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
