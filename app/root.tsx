import "@fontsource-variable/familjen-grotesk";
import { useContext } from "react";
import { MotionConfig } from "motion/react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
  type LinksFunction,
} from "react-router";

import { requestContext } from "~/context.ts";
import { getConfig } from "~/lib/session-context.server.ts";
import { LocaleContext } from "~/i18n/LocaleContext.ts";
import { t, type Locale } from "~/i18n/index.ts";

import { ToastProvider } from "./components/ui/index.ts";

import type { Route } from "./+types/root";
import "./app.css";

export function loader({ context }: Route.LoaderArgs) {
  const ctx = context.get(requestContext);
  return {
    cspNonce: ctx?.cspNonce ?? "",
    locale: ctx?.locale ?? ("sv" as Locale),
    // Not a secret: it is the public address canonical links, sitemaps and share previews point at.
    publicOrigin: getConfig().publicOrigin,
  };
}

export const links: LinksFunction = () => {
  return [
    { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    { rel: "manifest", href: "/site.webmanifest" },
  ];
};

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.cspNonce;
  const locale = data?.locale ?? "sv";

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#F2F5F4" />
        <Meta />
        <Links />
      </head>
      <body>
        <a href="#main" className="skip-link">
          {t(locale, "common.skipToContent")}
        </a>
        <MotionConfig reducedMotion="user">
          <LocaleContext.Provider value={locale}>
            <ToastProvider>{children}</ToastProvider>
          </LocaleContext.Provider>
        </MotionConfig>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const locale = useContext(LocaleContext);
  let message = t(locale, "errors.title");
  let details = t(locale, "errors.genericDetails");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = t(locale, "errors.notFound");
      details = t(locale, "errors.notFoundDetails");
    } else {
      message = t(locale, "errors.title");
      details = error.statusText || details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      className="bg-frost text-pine mx-auto flex min-h-screen max-w-[65ch] flex-col items-start justify-center gap-4 p-6"
    >
      <h1 className="text-h1 font-semibold">{message}</h1>
      <p className="text-body text-pine-soft">{details}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-control bg-pine text-body text-paper px-4 py-2 font-medium"
      >
        {t(locale, "errors.reload")}
      </button>
      {stack && (
        <pre className="rounded-card border-line bg-paper text-meta mt-4 w-full overflow-x-auto border p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
