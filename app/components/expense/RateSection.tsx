import { Field, Input } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

export type RateDirection = "base_per_unit" | "units_per_base";

export interface RateSectionProps {
  currency: string;
  baseCurrency: string;
  rateText: string;
  /**
   * Which way round the rate reads. New entries are always `base_per_unit` ("1 JPY = x SEK");
   * an entry saved the other way keeps its direction when edited, since converting the
   * displayed number would quietly change a rate that is meant to stay locked.
   */
  rateDirection: RateDirection;
  onRateTextChange: (value: string) => void;
  error?: string;
  /**
   * Where the prefilled rate came from — the live daily rate ("Dagens kurs") or the last rate
   * used in this group ("Senast använda kursen"). Omitted once the user has typed their own.
   */
  sourceCaption?: string;
}

/**
 * Shown when the transaction currency differs from the group's base currency: just the rate,
 * read as "1 JPY = [0,0625] SEK".
 */
export function RateSection({
  currency,
  baseCurrency,
  rateText,
  rateDirection,
  onRateTextChange,
  error,
  sourceCaption,
}: RateSectionProps) {
  const t = useT();
  const [from, to] = rateDirection === "base_per_unit" ? [currency, baseCurrency] : [baseCurrency, currency];
  const reading =
    rateDirection === "base_per_unit"
      ? t("common.rateDirectionBasePerUnit", { unit: currency, base: baseCurrency })
      : t("common.rateDirectionUnitsPerBase", { unit: currency, base: baseCurrency });

  return (
    <Field htmlFor="rateText" label={t("common.rateLabel")} hint={sourceCaption} error={error}>
      {(ids) => (
        <div className="flex items-center gap-2">
          <input type="hidden" name="rateDirection" value={rateDirection} />
          <span aria-hidden className="text-body text-pine shrink-0 font-medium tabular-nums">
            1 {from} =
          </span>
          <Input
            {...ids}
            name="rateText"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${t("common.rateLabel")}, ${reading}`}
            value={rateText}
            onChange={(e) => onRateTextChange(e.target.value)}
            placeholder={t("common.rateExamplePlaceholder")}
            className="min-w-0 flex-1"
          />
          <span aria-hidden className="text-body text-pine shrink-0 font-medium">
            {to}
          </span>
        </div>
      )}
    </Field>
  );
}
