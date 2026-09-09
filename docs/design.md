# Skyldig — Design system and UI direction

Audience: a group of friends on a trip, on phones, often outdoors, sometimes with one hand.
Primary job: answer "who pays whom, how much" in one glance; make adding an expense a
10-second task. Tone: friendly, plain Swedish ("du"), a little playful (the app's name means
"owing"), never enterprise.

## Tokens

Color (light theme only in MVP; the tokens are defined once in `app/app.css` `@theme`):

| Token | Hex | Use |
|---|---|---|
| `frost` | `#F2F5F4` | page background (cool, not cream) |
| `paper` | `#FFFFFF` | cards, inputs |
| `pine` | `#0F2A24` | text, primary buttons, focus rings |
| `pine-soft` | `#5B6E69` | secondary text |
| `sol` | `#FFD23F` | the one accent: highlights, selected chips, the settle-up rows |
| `moss` | `#1D8A4E` | "is owed" / positive balance |
| `rust` | `#D4462A` | "owes" / negative balance / destructive |
| `line` | `rgb(15 42 36 / 0.12)` | borders (no drop shadows anywhere) |

Type: **Familjen Grotesk** (self-hosted via `@fontsource-variable/familjen-grotesk`), one
family for everything. Scale (rem): 0.8125 (meta), 0.9375 (body), 1.125 (lead), 1.5 (h2),
2 (h1), 3 (money hero). Money always uses `font-variant-numeric: tabular-nums` and weight 600.
Body line-height 1.5, headings 1.15. Max line length 65ch. Sentence case everywhere; no
all-caps labels; no eyebrow labels; no middle-dot meta strings.

Radius hierarchy: settle-up rows and dialogs 20px; cards 14px; inputs/buttons 10px; chips 999px.

Spacing scale: 4, 8, 12, 16, 24, 32, 48.

Motion (`motion` lib, everything inside `<MotionConfig reducedMotion="user">`): one
orchestrated moment per screen — on the dashboard the settle-up rows stagger in once (60 ms
apart, 240 ms, ease-out); after a successful mutation the changed balance number crossfades
to the new value. Dialogs scale from 0.96 to 1 over 160 ms. No hover-lift on cards, no
decorative movement, no per-section fade-ins.

## Layout

Mobile (default): single column, 16px gutters, sticky top bar (session name + expiry
pill), sticky bottom action bar with three actions: "Ny utgift" (primary, pine), "Betalning",
"Person". Content is left-aligned.

Desktop (≥ 880px): two columns. Left rail 300px, sticky: session name, expiry, participants
with balances, nav (Översikt, Aktivitet, Gör upp, Deltagare, Admin). Right column
max-width 720px with the same content as mobile; the action bar becomes a row of buttons
under the page title.

```
┌────────────────────────────────────────────────┐
│ Japan 2026            Går ut 8 dec              │  top bar (mobile)
├────────────────────────────────────────────────┤
│ Kvar att göra upp                               │
│ 605 kr                                          │  money hero (3rem, tabular)
│                                                 │
│ ┌──────────────────────────────────────────┐    │
│ │ Peter  ───────▶  Johan           300 kr  │    │  settle-up row (sol tint)
│ └──────────────────────────────────────────┘    │
│ ┌──────────────────────────────────────────┐    │
│ │ Peter  ───────▶  Anna            100 kr  │    │
│ └──────────────────────────────────────────┘    │
│                                                 │
│ Senaste                                         │
│ Hotell · Johan betalade 1 200 kr        idag    │  activity list (plain rows, 1px lines)
│ …                                               │
├────────────────────────────────────────────────┤
│ [ Ny utgift ]   [ Betalning ]   [ Person ]      │  bottom action bar
└────────────────────────────────────────────────┘
```

The memorable element is the settle-up row: the two names at the ends of a drawn arrow, the
amount large and tabular, on a `sol` tint. Everything else is quiet: white cards on frost,
1px lines, generous whitespace.

## Components (`app/components/ui`)

Button (variants primary/secondary/ghost/danger, sizes md/lg, `loading` state), Input,
Textarea, Select (native `<select>`, styled), Field (label + hint + error, ties `aria-describedby`),
Chip (toggle, used for participant selection, `aria-pressed`), MoneyInput (text input with
inputmode="decimal", currency suffix), Dialog (Radix, focus trap, `aria-labelledby`),
ConfirmDialog, Toast (aria-live polite), EmptyState (headline + one action), Pill (expiry),
Avatar (initials on pine/sol/moss/rust rotation by position), Money (formats minor units with
`formatMoney`, tabular), ActionBar.

## Copy rules (Swedish)

- Session = "grupp" in the UI ("Skapa grupp", "Gå med i grupp"). Expense = "utgift".
  Repayment = "betalning". Settle up = "Gör upp". Participants = "deltagare".
- Access phrase = "gruppnyckel"; admin key = "adminnyckel".
- Buttons say what happens: "Spara utgift", "Ta bort utgift", "Gå med".
- Errors say what went wrong and what to do: "Nyckeln stämmer inte. Kontrollera stavningen
  och försök igen."
- Empty states invite: "Inga utgifter än. Lägg till den första."
- Money: `sv-SE` formatting, "1 200 kr", "90 €", "50 US$" via Intl narrowSymbol.

## Accessibility floor

Semantic landmarks (header/nav/main), one h1 per page, labels on every control, 3:1 focus
ring (pine, 2px offset), 4.5:1 text contrast (pine on frost/paper, white on pine), 44px touch
targets, dialogs with focus trap and Escape, `aria-live` for toasts and updated balances,
skip link, `prefers-reduced-motion` respected through MotionConfig.
