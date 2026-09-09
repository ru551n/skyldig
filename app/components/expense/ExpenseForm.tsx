import { useMemo, useState } from "react";
import { Form, useFetcher } from "react-router";

import { convertToBase, parseAmount, splitEqually } from "@domain/index.ts";

import {
  Button,
  Chip,
  Field,
  Input,
  Money,
  MoneyInput,
  Select,
  Textarea,
} from "~/components/ui/index.ts";
import { useT } from "~/i18n";

import { RateSection, type RateDirection } from "./RateSection.tsx";

export interface ParticipantOption {
  publicId: string;
  displayName: string;
  /**
   * The participant's real ordering within the session, used for the
   * split preview so it matches what the server will store. Optional for
   * backward compatibility with callers that have not threaded it through
   * yet; falls back to array index (which only agrees with the real
   * position when the list already arrives in position order).
   */
  position?: number;
}

export interface CurrencyOption {
  code: string;
  decimals: number;
  name: string;
}

export interface ExpenseFormError {
  field?: string;
  code: string;
}

export interface ExpenseFormDefaults {
  description: string;
  amountText: string;
  currencyCode: string;
  rateText: string;
  rateDirection: RateDirection;
  payerPublicId: string;
  participantPublicIds: string[];
  expenseDate: string;
  note: string;
}

export interface ExpenseFormProps {
  participants: ParticipantOption[];
  currencies: CurrencyOption[];
  baseCurrency: string;
  defaults: ExpenseFormDefaults;
  error?: ExpenseFormError;
  errorMessage?: (code: string) => string;
  revision?: number;
  submitting: boolean;
  submitLabel: string;
  formId?: string;
}

/**
 * Shared description/amount/payer/split/date/note form for expense-new and
 * expense-edit. Renders its own `<Form method="post">` — callers add any
 * extra actions (delete dialog, conflict banner) around it.
 */
export function ExpenseForm({
  participants,
  currencies,
  baseCurrency,
  defaults,
  error,
  errorMessage,
  revision,
  submitting,
  submitLabel,
  formId,
}: ExpenseFormProps) {
  const t = useT();
  const fetcher = useFetcher<{
    suggestedRate: { rateText: string; rateDirection: RateDirection } | null;
  }>();

  const [description, setDescription] = useState(defaults.description);
  const [amountText, setAmountText] = useState(defaults.amountText);
  const [currencyCode, setCurrencyCode] = useState(defaults.currencyCode);
  const [rateText, setRateText] = useState(defaults.rateText);
  const [rateDirection, setRateDirection] = useState<RateDirection>(defaults.rateDirection);
  const [payerPublicId, setPayerPublicId] = useState(defaults.payerPublicId);
  const [selected, setSelected] = useState<Set<string>>(new Set(defaults.participantPublicIds));
  const [noteOpen, setNoteOpen] = useState(Boolean(defaults.note));
  const [note, setNote] = useState(defaults.note);
  const [expenseDate, setExpenseDate] = useState(defaults.expenseDate);

  const isForeign = currencyCode !== baseCurrency;

  function handleCurrencyChange(code: string) {
    setCurrencyCode(code);
    if (code !== baseCurrency) {
      setRateText("");
      fetcher.load(`${window.location.pathname}?currency=${encodeURIComponent(code)}`);
    } else {
      setRateText("");
    }
  }

  const suggested = fetcher.data?.suggestedRate;
  const effectiveRateText = rateText || suggested?.rateText || "";
  const effectiveRateDirection = rateText
    ? rateDirection
    : (suggested?.rateDirection ?? rateDirection);

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(participants.map((p) => p.publicId)) : new Set());
  }

  function toggleOne(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const preview = useMemo(() => {
    try {
      const amountMinor = parseAmount(amountText, currencyCode);
      let baseAmountMinor = amountMinor;
      if (isForeign) {
        const rateStr = effectiveRateText;
        if (!rateStr) return null;
        const rate = parseRateSafe(rateStr, effectiveRateDirection);
        if (!rate) return null;
        baseAmountMinor = convertToBase(
          { amountMinor, currency: currencyCode },
          baseCurrency,
          rate,
        );
      }
      const ids = [...selected];
      if (ids.length === 0) return null;
      const parts = participants
        .filter((p) => selected.has(p.publicId))
        .map((p, index) => ({ id: p.publicId, position: p.position ?? index }));
      const shares = splitEqually(baseAmountMinor, parts);
      const byId = new Map(participants.map((p) => [p.publicId, p.displayName]));
      return {
        baseAmountMinor,
        shares: shares.map((s) => ({ name: byId.get(s.id) ?? s.id, share: s.share })),
      };
    } catch {
      return null;
    }
  }, [
    amountText,
    currencyCode,
    isForeign,
    effectiveRateText,
    effectiveRateDirection,
    selected,
    participants,
    baseCurrency,
  ]);

  const fieldError = (field: string) =>
    error?.field === field && errorMessage ? errorMessage(error.code) : undefined;

  return (
    <Form method="post" id={formId} className="flex flex-col gap-6">
      {revision !== undefined && <input type="hidden" name="revision" value={revision} />}

      <Field
        htmlFor="description"
        label={t("expense.descriptionLabel")}
        error={fieldError("description")}
      >
        {(ids) => (
          <Input
            {...ids}
            name="description"
            autoFocus
            required
            maxLength={120}
            placeholder={t("expense.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>

      <div className="flex items-end gap-3">
        <Field
          htmlFor="amountText"
          label={t("expense.amountLabel")}
          error={fieldError("amountText")}
          className="flex-1"
        >
          {(ids) => (
            <MoneyInput
              {...ids}
              name="amountText"
              required
              currency={currencyCode}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          )}
        </Field>
        <div className="w-[6.5rem] flex-shrink-0">
          <label htmlFor="currencyCode" className="sr-only">
            {t("common.currencyLabel")}
          </label>
          <Select
            id="currencyCode"
            name="currencyCode"
            value={currencyCode}
            onChange={(e) => handleCurrencyChange(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isForeign && (
        <RateSection
          currency={currencyCode}
          baseCurrency={baseCurrency}
          rateText={effectiveRateText}
          rateDirection={effectiveRateDirection}
          onRateTextChange={setRateText}
          onRateDirectionChange={setRateDirection}
          error={fieldError("rateText")}
        />
      )}

      <Field
        htmlFor="payerPublicId"
        label={t("expense.payerLabel")}
        error={fieldError("payerPublicId")}
      >
        {(ids) => (
          <Select
            {...ids}
            name="payerPublicId"
            value={payerPublicId}
            onChange={(e) => setPayerPublicId(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p.publicId} value={p.publicId}>
                {p.displayName}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-pine font-medium">{t("expense.participantsLabel")}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => toggleAll(true)}>
              {t("common.selectAll")}
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => toggleAll(false)}>
              {t("common.deselectAll")}
            </Button>
          </div>
        </div>
        <div
          role="group"
          aria-label={t("expense.participantsGroupLabel")}
          className="flex flex-wrap gap-2"
        >
          {participants.map((p) => (
            <Chip
              key={p.publicId}
              pressed={selected.has(p.publicId)}
              onPressedChange={(on) => toggleOne(p.publicId, on)}
            >
              {p.displayName}
            </Chip>
          ))}
        </div>
        {participants.map((p) =>
          selected.has(p.publicId) ? (
            <input key={p.publicId} type="hidden" name="participantPublicIds" value={p.publicId} />
          ) : null,
        )}
        {fieldError("participantPublicIds") && (
          <p role="alert" className="text-meta text-rust font-medium">
            {fieldError("participantPublicIds")}
          </p>
        )}
      </div>

      {preview && preview.shares.length > 0 && (
        <div className="rounded-card border-line bg-paper flex flex-col gap-1 border p-4">
          <p className="text-meta text-pine-soft font-medium">{t("expense.splitPreviewLabel")}</p>
          {isForeign && (
            <p className="text-meta text-pine-soft">
              {t("common.totalOriginal", { amount: `${amountText} ${currencyCode}` })}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {preview.shares.map((s, i) => (
              <li key={i} className="text-body text-pine flex items-center justify-between">
                <span>{s.name}</span>
                <Money amountMinor={s.share} currency={baseCurrency} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field htmlFor="expenseDate" label={t("expense.whenLabel")} error={fieldError("expenseDate")}>
        {(ids) => (
          <Input
            {...ids}
            type="date"
            name="expenseDate"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        {!noteOpen ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setNoteOpen(true)}
            className="self-start"
          >
            {t("common.addNote")}
          </Button>
        ) : (
          <Field htmlFor="note" label={t("common.noteLabel")} error={fieldError("note")}>
            {(ids) => (
              <Textarea
                {...ids}
                name="note"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>

      {error && !error.field && errorMessage && (
        <p
          role="alert"
          className="rounded-control border-rust/40 bg-rust/5 text-body text-rust border p-3"
        >
          {errorMessage(error.code)}
        </p>
      )}

      <Button type="submit" size="lg" loading={submitting} disabled={submitting} fullWidth>
        {submitLabel}
      </Button>
    </Form>
  );
}

/** Minimal client-side rate parser mirroring `domain/currency/rate.ts` `parseRate`, used only to hide/show the preview. */
function parseRateSafe(
  text: string,
  direction: RateDirection,
): { num: bigint; den: bigint; direction: RateDirection; text: string } | null {
  const trimmed = text.trim();
  const match = /^([0-9]+)(?:[.,]([0-9]{1,12}))?$/.exec(trimmed);
  if (!match) return null;
  const intPart = match[1]!;
  const fracPart = match[2] ?? "";
  const rawNum = BigInt(intPart + fracPart);
  const rawDen = 10n ** BigInt(fracPart.length);
  if (rawNum === 0n) return null;
  const [num, den] = direction === "units_per_base" ? [rawDen, rawNum] : [rawNum, rawDen];
  return { num, den, direction, text: trimmed };
}
