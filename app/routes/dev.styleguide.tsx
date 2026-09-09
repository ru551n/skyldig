import { useState } from "react";

import {
  ActionBar,
  Arrow,
  Avatar,
  Button,
  ButtonLink,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Money,
  MoneyInput,
  PageHeader,
  Pill,
  Row,
  Select,
  Textarea,
  useToast,
} from "~/components/ui/index.ts";

import type { Route } from "./+types/dev.styleguide";

export function loader(_args: Route.LoaderArgs) {
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not Found", { status: 404 });
  }
  return null;
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Styleguide — Skyldig" }];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-line flex flex-col gap-4 border-t pt-8 first:border-t-0 first:pt-0">
      <h2 className="text-h2 text-pine font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export default function StyleguidePage() {
  const [pressed, setPressed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const { showToast } = useToast();

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-4xl flex-col gap-10 p-6 pb-32">
      <PageHeader
        title="Styleguide"
        lead="Alla komponenter i sina olika tillstånd — endast i utvecklingsläge."
        right={<Pill variant="warning">Går ut 8 dec</Pill>}
      />

      <Section title="Buttons">
        <Button variant="primary">Spara utgift</Button>
        <Button variant="secondary">Avbryt</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Ta bort utgift</Button>
        <Button variant="primary" loading>
          Sparar…
        </Button>
        <Button variant="primary" disabled>
          Inaktiv
        </Button>
        <Button variant="primary" size="lg" fullWidth>
          Full bredd, lg
        </Button>
        <ButtonLink to="/" variant="secondary">
          Länk-knapp
        </ButtonLink>
      </Section>

      <Section title="Inputs">
        <Field htmlFor="sg-name" label="Namn" hint="Visas för de andra i gruppen">
          {(ids) => <Input {...ids} name="name" placeholder="t.ex. Peter" />}
        </Field>
        <Field htmlFor="sg-invalid" label="Namn" error="Namn krävs.">
          {(ids) => <Input {...ids} name="name-invalid" placeholder="t.ex. Peter" />}
        </Field>
        <Field htmlFor="sg-note" label="Anteckning">
          {(ids) => <Textarea {...ids} name="note" placeholder="Valfri kommentar" />}
        </Field>
        <Field htmlFor="sg-currency" label="Valuta">
          {(ids) => (
            <Select {...ids} name="currency">
              <option value="SEK">SEK</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </Select>
          )}
        </Field>
        <Field htmlFor="sg-amount" label="Belopp">
          {(ids) => (
            <MoneyInput {...ids} name="amount" currency="SEK" defaultValue="" placeholder="0" />
          )}
        </Field>
      </Section>

      <Section title="Chip">
        <Chip pressed={pressed} onPressedChange={setPressed}>
          Anna
        </Chip>
        <Chip pressed={!pressed} onPressedChange={() => setPressed((p) => !p)}>
          Johan
        </Chip>
      </Section>

      <Section title="Money">
        <Money amountMinor={120000n} currency="SEK" size="hero" />
        <Money amountMinor={30000n} currency="SEK" signed size="lead" />
        <Money amountMinor={-15050n} currency="SEK" signed size="lead" />
      </Section>

      <Section title="Avatars">
        <div className="flex items-center gap-3">
          {["Peter Andersson", "Johan Karlsson", "Anna Svensson", "Maria Nilsson"].map(
            (name, i) => (
              <div key={name} className="flex items-center gap-2">
                <Avatar name={name} position={i} />
                <span className="text-body text-pine">{name}</span>
              </div>
            ),
          )}
        </div>
      </Section>

      <Section title="Settle-up row (Card + Arrow)">
        <Card tinted className="w-full max-w-md">
          <div className="flex items-center justify-between gap-4">
            <div className="text-body text-pine flex items-center gap-3 font-medium">
              <span>Peter</span>
              <Arrow className="text-pine-soft" />
              <span>Johan</span>
            </div>
            <Money amountMinor={30000n} currency="SEK" size="lead" />
          </div>
        </Card>
      </Section>

      <Section title="Card / Row (activity list)">
        <Card className="w-full max-w-md">
          <Row>
            <span className="text-body text-pine">Hotell · Johan betalade 1 200 kr</span>
            <span className="text-meta text-pine-soft">idag</span>
          </Row>
          <Row noDivider>
            <span className="text-body text-pine">Middag · Anna betalade 450 kr</span>
            <span className="text-meta text-pine-soft">igår</span>
          </Row>
        </Card>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          headline="Inga utgifter än"
          body="Lägg till den första."
          action={<Button variant="primary">Ny utgift</Button>}
        />
      </Section>

      <Section title="Pill">
        <Pill variant="neutral">Neutral</Pill>
        <Pill variant="warning">Går ut 8 dec</Pill>
      </Section>

      <Section title="Dialog">
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Ny utgift"
          description="Fyll i vad utgiften gällde."
          trigger={<Button variant="primary">Öppna dialog</Button>}
        >
          <p className="text-body text-pine-soft">Dialoginnehåll här.</p>
        </Dialog>

        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Öppna ConfirmDialog
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Ta bort utgiften?"
          body="Det går inte att ångra."
          confirmLabel="Ta bort"
          destructive
          pending={confirmPending}
          onConfirm={() => {
            setConfirmPending(true);
            setTimeout(() => {
              setConfirmPending(false);
              setConfirmOpen(false);
            }, 800);
          }}
        />
      </Section>

      <Section title="Toast">
        <Button variant="secondary" onClick={() => showToast("success", "Utgiften sparades.")}>
          Visa success-toast
        </Button>
        <Button variant="secondary" onClick={() => showToast("error", "Något gick fel.")}>
          Visa error-toast
        </Button>
      </Section>

      <ActionBar>
        <Button variant="primary" fullWidth>
          Ny utgift
        </Button>
        <Button variant="secondary" fullWidth>
          Betalning
        </Button>
        <Button variant="secondary" fullWidth>
          Person
        </Button>
      </ActionBar>
    </main>
  );
}
