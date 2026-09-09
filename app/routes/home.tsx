import { useT } from "~/i18n";

import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Skyldig" }, { name: "description", content: "Dela utgifter enkelt." }];
}

export default function Home() {
  const t = useT();

  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-4xl font-bold">{t("appName")}</h1>
      <p className="text-gray-600 dark:text-gray-400">{t("home.placeholder")}</p>
    </main>
  );
}
