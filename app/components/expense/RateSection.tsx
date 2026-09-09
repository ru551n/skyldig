import { Field, Input, Select } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

export type RateDirection = "base_per_unit" | "units_per_base";

export interface RateSectionProps {
  currency: string;
  baseCurrency: string;
  rateText: string;
  rateDirection: RateDirection;
  onRateTextChange: (value: string) => void;
  onRateDirectionChange: (value: RateDirection) => void;
  error?: string;
}

/**
 * Shown when the chosen transaction currency differs from the session's base
 * currency: a rate text input plus a direction toggle with both readings
 * spelled out in Swedish, per docs/design.md's plain-language copy rule.
 */
export function RateSection({
  currency,
  baseCurrency,
  rateText,
  rateDirection,
  onRateTextChange,
  onRateDirectionChange,
  error,
}: RateSectionProps) {
  const t = useT();

  return (
    <div className="rounded-card border-line bg-frost flex flex-col gap-3 border p-4">
      <Field htmlFor="rateDirection" label={t("common.rateLabel")} error={error}>
        {(ids) => (
          <div className="flex flex-col gap-2">
            <Select
              {...ids}
              name="rateDirection"
              value={rateDirection}
              onChange={(e) => onRateDirectionChange(e.target.value as RateDirection)}
            >
              <option value="base_per_unit">
                {t("common.rateDirectionBasePerUnit", { unit: currency, base: baseCurrency })}
              </option>
              <option value="units_per_base">
                {t("common.rateDirectionUnitsPerBase", { unit: currency, base: baseCurrency })}
              </option>
            </Select>
            <label htmlFor="rateText" className="sr-only">
              {t("common.rateLabel")}
            </label>
            <Input
              id="rateText"
              name="rateText"
              inputMode="decimal"
              autoComplete="off"
              value={rateText}
              onChange={(e) => onRateTextChange(e.target.value)}
              placeholder="t.ex. 11,45"
            />
          </div>
        )}
      </Field>
      <p className="text-meta text-pine-soft">{t("common.rateLockedHint")}</p>
    </div>
  );
}
