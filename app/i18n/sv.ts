/**
 * Swedish copy catalog. Grouped by screen/domain area per docs/architecture.md
 * §10. Route implementers may add keys — the type is derived from this
 * object, so new keys stay type-safe automatically.
 *
 * Values are either a plain string or a function `(params) => string` for
 * messages that take parameters or need pluralization.
 */
export const sv = {
  appName: "Skyldig",

  common: {
    save: "Spara",
    cancel: "Avbryt",
    close: "Stäng",
    delete: "Ta bort",
    edit: "Ändra",
    back: "Tillbaka",
    loading: "Laddar…",
    today: "idag",
    yesterday: "igår",
  },

  landing: {
    title: "Skyldig",
    lead: "Dela utgifter med vänner, enkelt och utan konto.",
    createSession: "Skapa grupp",
    joinSession: "Gå med i grupp",
    yourSessions: "Grupper du gått med i",
    noSessions: "Du har inte gått med i någon grupp än.",
  },

  create: {
    title: "Skapa grupp",
    lead: "Ge gruppen ett namn och lägg till de som ska vara med. Ni kan lägga till fler senare.",
    nameLabel: "Namn på gruppen",
    namePlaceholder: "t.ex. Japan 2026",
    baseCurrencyLabel: "Valuta",
    participantsLabel: "Deltagare",
    addParticipant: "Lägg till deltagare",
    submit: "Skapa grupp",
    resultTitle: "Gruppen är skapad",
    resultLead: "Spara den här sidan eller skicka nyckeln till de andra — den visas bara en gång.",
    phraseLabel: "Gruppnyckel",
    adminKeyLabel: "Adminnyckel",
    goToSession: "Till gruppen",
  },

  join: {
    title: "Gå med i grupp",
    lead: "Klistra in gruppnyckeln du fått av någon i gruppen.",
    phraseLabel: "Gruppnyckel",
    submit: "Gå med",
  },

  dashboard: {
    title: "Översikt",
    remainingToSettle: "Kvar att göra upp",
    allSettled: "Allt är uppgjort. Bra jobbat.",
    recent: "Senaste",
    noExpenses: "Inga utgifter än. Lägg till den första.",
    nav: {
      overview: "Översikt",
      activity: "Aktivitet",
      settle: "Gör upp",
      participants: "Deltagare",
      admin: "Admin",
    },
    actions: {
      newExpense: "Ny utgift",
      newPayment: "Betalning",
      newParticipant: "Person",
    },
  },

  expense: {
    newTitle: "Ny utgift",
    editTitle: "Ändra utgift",
    detailTitle: "Utgift",
    descriptionLabel: "Vad gällde det?",
    descriptionPlaceholder: "t.ex. Hotell",
    amountLabel: "Belopp",
    payerLabel: "Vem betalade?",
    dateLabel: "Datum",
    splitLabel: "Fördelning",
    splitEqual: "Dela lika",
    splitCustom: "Anpassad fördelning",
    submit: "Spara utgift",
    delete: "Ta bort utgift",
    deleteConfirmTitle: "Ta bort utgiften?",
    deleteConfirmBody: "Det går inte att ångra. Beloppet räknas bort från alla saldon.",
    paidBy: (params: { name: string }) => `${params.name} betalade`,
    history: "Historik",
  },

  payment: {
    newTitle: "Ny betalning",
    editTitle: "Ändra betalning",
    fromLabel: "Vem betalade?",
    toLabel: "Vem fick betalningen?",
    amountLabel: "Belopp",
    dateLabel: "Datum",
    submit: "Spara betalning",
    delete: "Ta bort betalning",
    deleteConfirmTitle: "Ta bort betalningen?",
    deleteConfirmBody: "Det går inte att ångra. Saldona räknas om.",
  },

  participants: {
    title: "Deltagare",
    addTitle: "Lägg till deltagare",
    nameLabel: "Namn",
    add: "Lägg till",
    rename: "Byt namn",
    noParticipants: "Inga deltagare än.",
    count: (params: { n: number }) =>
      params.n === 1 ? "1 deltagare" : `${params.n} deltagare`,
    removeConfirmTitle: "Ta bort deltagaren?",
    removeConfirmBody: "Går bara om personen saknar utgifter och betalningar.",
  },

  activity: {
    title: "Aktivitet",
    lead: "Allt som hänt i gruppen, inklusive borttaget.",
    empty: "Inget har hänt än.",
    deleted: "Borttagen",
    edited: "Ändrad",
  },

  settle: {
    title: "Gör upp",
    lead: "Så här löser ni skulderna med så få betalningar som möjligt.",
    empty: "Inget att göra upp. Alla är kvitt.",
    pay: (params: { from: string; to: string }) => `${params.from} betalar ${params.to}`,
  },

  admin: {
    title: "Admin",
    lead: "Endast synligt med adminnyckeln.",
    elevateTitle: "Bli admin",
    elevateLabel: "Adminnyckel",
    elevateSubmit: "Bli admin",
    rotatePhrase: "Byt gruppnyckel",
    rotateAdminKey: "Byt adminnyckel",
    deleteSession: "Ta bort gruppen",
    deleteConfirmTitle: "Ta bort gruppen?",
    deleteConfirmBody: "All data i gruppen försvinner permanent. Det går inte att ångra.",
    expiresLabel: (params: { date: string }) => `Går ut ${params.date}`,
  },

  errors: {
    title: "Något gick fel",
    generic: "Något gick fel. Försök igen om en stund.",
    notFound: "Sidan finns inte",
    reload: "Ladda om sidan",
    keyMismatch: "Nyckeln stämmer inte. Kontrollera stavningen och försök igen.",
  },

  validation: {
    INVALID_AMOUNT: "Beloppet ser inte rätt ut. Skriv ett belopp som 100 eller 99,50.",
    TOO_MANY_DECIMALS: "För många decimaler för den här valutan.",
    AMOUNT_TOO_LARGE: "Beloppet är för stort.",
    AMOUNT_TOO_SMALL_IN_BASE: "Beloppet blir för litet när det räknas om till gruppens valuta.",
    INVALID_RATE: "Växelkursen ser inte rätt ut.",
    EMPTY_SPLIT: "Välj minst en person att dela med.",
    UNKNOWN_CURRENCY: "Okänd valuta.",
    PARTICIPANT_NAME_TAKEN: "Namnet är redan taget i den här gruppen.",
    PARTICIPANT_HAS_HISTORY: "Går inte att ta bort — personen har utgifter eller betalningar.",
    SAME_PARTICIPANT: "Välj två olika personer.",
    UNKNOWN_PARTICIPANT: "Personen hittades inte.",
    CONFLICT: "Någon annan hann ändra samtidigt. Ladda om och försök igen.",
    RATE_LIMITED: "För många försök. Vänta en liten stund och försök igen.",
    INVALID_KEY: "Nyckeln stämmer inte. Kontrollera stavningen och försök igen.",
    NAME_REQUIRED: "Namn krävs.",
    NAME_TOO_LONG: "Namnet är för långt.",
    DESCRIPTION_REQUIRED: "Beskrivning krävs.",
    DATE_INVALID: "Datumet ser inte rätt ut.",
  },
} as const satisfies Record<string, unknown>;
