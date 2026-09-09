import { useState } from "react";
import { useRouteLoaderData } from "react-router";

import { getCurrencyDecimals } from "@domain/currency/registry.ts";
import { formatMinorAsDecimal } from "@domain/money/money.ts";

import { Button, ButtonLink, EmptyState, Money } from "~/components/ui/index.ts";
import { SettleRow } from "~/components/session/SettleRow.tsx";
import { SESSION_LAYOUT_ROUTE_ID, type SessionLayoutData } from "~/components/session/types.ts";
import { useT } from "~/i18n";

export function meta() {
  return [{ title: "Gör upp — Skyldig" }];
}

/** Builds the payment-form prefill URL: `betalningar/ny?from=&to=&amount=&currency=`. */
function paymentPrefillUrl(
  from: string,
  to: string,
  amountMinor: string,
  currency: string,
): string {
  const decimals = getCurrencyDecimals(currency);
  const amount = formatMinorAsDecimal(BigInt(amountMinor), decimals);
  const params = new URLSearchParams({ from, to, amount, currency });
  return `betalningar/ny?${params.toString()}`;
}

function DetailsTable({
  balances,
  currency,
}: {
  balances: SessionLayoutData["balances"]["balances"];
  currency: string;
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-body">
        <thead>
          <tr className="border-b border-line text-left text-meta text-pine-soft">
            <th className="py-2 pr-3 font-medium">{t("settle.detailName")}</th>
            <th className="py-2 pr-3 text-right font-medium">{t("settle.detailPaid")}</th>
            <th className="py-2 pr-3 text-right font-medium">{t("settle.detailShare")}</th>
            <th className="py-2 pr-3 text-right font-medium">{t("settle.detailRepaid")}</th>
            <th className="py-2 pr-3 text-right font-medium">{t("settle.detailReceived")}</th>
            <th className="py-2 text-right font-medium">{t("settle.detailNet")}</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.publicId} className="border-b border-line last:border-b-0">
              <td className="py-2 pr-3 text-pine">{b.displayName}</td>
              <td className="py-2 pr-3 text-right">
                <Money amountMinor={b.paid} currency={currency} />
              </td>
              <td className="py-2 pr-3 text-right">
                <Money amountMinor={b.share} currency={currency} />
              </td>
              <td className="py-2 pr-3 text-right">
                <Money amountMinor={b.repaid} currency={currency} />
              </td>
              <td className="py-2 pr-3 text-right">
                <Money amountMinor={b.received} currency={currency} />
              </td>
              <td className="py-2 text-right">
                <Money amountMinor={b.net} currency={currency} signed />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Settle() {
  const t = useT();
  const layoutData = useRouteLoaderData(SESSION_LAYOUT_ROUTE_ID) as SessionLayoutData;
  const { participants, balances } = layoutData;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-semibold text-pine">{t("settle.title")}</h1>
        <p className="mt-1 text-body text-pine-soft">{t("settle.lead")}</p>
      </div>

      {participants.length === 0 ? (
        <EmptyState headline={t("common.noParticipantsHeadline")} body={t("common.noParticipantsBody")} />
      ) : balances.transfers.length === 0 ? (
        <EmptyState headline={t("common.allSettledHeadline")} body={t("settle.empty")} />
      ) : (
        <section className="flex flex-col gap-3">
          {balances.transfers.map((transfer, index) => (
            <SettleRow
              key={`${transfer.from.publicId}-${transfer.to.publicId}`}
              from={transfer.from.displayName}
              to={transfer.to.displayName}
              amountMinor={transfer.amountMinor}
              currency={balances.baseCurrency}
              index={index}
              action={
                <ButtonLink
                  to={paymentPrefillUrl(
                    transfer.from.publicId,
                    transfer.to.publicId,
                    transfer.amountMinor,
                    balances.baseCurrency,
                  )}
                  size="md"
                  variant="secondary"
                >
                  {t("common.registerPayment")}
                </ButtonLink>
              }
            />
          ))}
        </section>
      )}

      {participants.length > 0 && (
        <section className="flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            aria-expanded={detailsOpen}
            aria-controls="settle-details"
            onClick={() => setDetailsOpen((open) => !open)}
            className="self-start"
          >
            {t("settle.detailsToggle")}
          </Button>
          {detailsOpen && (
            <div id="settle-details">
              <DetailsTable balances={balances.balances} currency={balances.baseCurrency} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
