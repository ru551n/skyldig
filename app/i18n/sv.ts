export const sv = {
  appName: "Skyldig",
  "home.placeholder": "Dela utgifter med vänner, enkelt och utan konto.",
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- catalog values may take arbitrary params
} as const satisfies Record<string, string | ((params: any) => string)>;
