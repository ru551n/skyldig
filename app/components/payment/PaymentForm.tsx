import { useState } from "react";
import { Form, useFetcher } from "react-router";

import { RateSection, type RateDirection } from "~/components/expense/RateSection.tsx";
import { Button, Field, Input, MoneyInput, Select, Textarea } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

export interface ParticipantOption {
  publicId: string;
  displayName: string;
}

export interface CurrencyOption {
  code: string;
  decimals: number;
  name: string;
}

export interface PaymentFormError {
  field?: string;
  code: string;
}

export interface PaymentFormDefaults {
  amountText: string;
  currencyCode: string;
  rateText: string;
  rateDirection: RateDirection;
  payerPublicId: string;
  recipientPublicId: string;
  paymentDate: string;
  note: string;
}

export interface PaymentFormProps {
  participants: ParticipantOption[];
  currencies: CurrencyOption[];
  baseCurrency: string;
  defaults: PaymentFormDefaults;
  error?: PaymentFormError;
  errorMessage?: (code: string) => string;
  revision?: number;
  submitting: boolean;
  submitLabel: string;
}

/** Shared payer/recipient/amount/date/note form for payment-new and payment-edit. */
export function PaymentForm({
  participants,
  currencies,
  baseCurrency,
  defaults,
  error,
  errorMessage,
  revision,
  submitting,
  submitLabel,
}: PaymentFormProps) {
  const t = useT();
  const fetcher = useFetcher<{
    suggestedRate: { rateText: string; rateDirection: RateDirection } | null;
  }>();

  const [amountText, setAmountText] = useState(defaults.amountText);
  const [currencyCode, setCurrencyCode] = useState(defaults.currencyCode);
  const [rateText, setRateText] = useState(defaults.rateText);
  const [rateDirection, setRateDirection] = useState<RateDirection>(defaults.rateDirection);
  const [payerPublicId, setPayerPublicId] = useState(defaults.payerPublicId);
  const [recipientPublicId, setRecipientPublicId] = useState(defaults.recipientPublicId);
  const [noteOpen, setNoteOpen] = useState(Boolean(defaults.note));
  const [note, setNote] = useState(defaults.note);
  const [paymentDate, setPaymentDate] = useState(defaults.paymentDate);

  const isForeign = currencyCode !== baseCurrency;
  const samePerson = payerPublicId === recipientPublicId;

  function handleCurrencyChange(code: string) {
    setCurrencyCode(code);
    setRateText("");
    if (code !== baseCurrency) {
      fetcher.load(`${window.location.pathname}?currency=${encodeURIComponent(code)}`);
    }
  }

  const suggested = fetcher.data?.suggestedRate;
  const effectiveRateText = rateText || suggested?.rateText || "";
  const effectiveRateDirection = rateText
    ? rateDirection
    : (suggested?.rateDirection ?? rateDirection);

  const fieldError = (field: string) =>
    error?.field === field && errorMessage ? errorMessage(error.code) : undefined;

  return (
    <Form method="post" className="flex flex-col gap-6">
      {revision !== undefined && <input type="hidden" name="revision" value={revision} />}

      <Field
        htmlFor="payerPublicId"
        label={t("payment.fromLabel")}
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

      <Field
        htmlFor="recipientPublicId"
        label={t("payment.toLabel")}
        error={
          fieldError("recipientPublicId") ?? (samePerson ? t("payment.samePersonHint") : undefined)
        }
      >
        {(ids) => (
          <Select
            {...ids}
            name="recipientPublicId"
            value={recipientPublicId}
            onChange={(e) => setRecipientPublicId(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p.publicId} value={p.publicId} disabled={p.publicId === payerPublicId}>
                {p.displayName}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex items-end gap-3">
        <Field
          htmlFor="amountText"
          label={t("payment.amountLabel")}
          error={fieldError("amountText")}
          className="min-w-0 flex-1"
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

      <Field htmlFor="paymentDate" label={t("payment.dateLabel")} error={fieldError("paymentDate")}>
        {(ids) => (
          <Input
            {...ids}
            type="date"
            name="paymentDate"
            required
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
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

      <Button
        type="submit"
        size="lg"
        loading={submitting}
        disabled={submitting || samePerson}
        fullWidth
      >
        {submitLabel}
      </Button>
    </Form>
  );
}
