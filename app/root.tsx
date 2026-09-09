import "@fontsource-variable/familjen-grotesk";
import { MotionConfig } from "motion/react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import { requestContext } from "~/context.ts";

import { ToastProvider } from "./components/ui/index.ts";

import type { Route } from "./+types/root";
import "./app.css";

export function loader({ context }: Route.LoaderArgs) {
  return { cspNonce: context.get(requestContext)?.cspNonce ?? "" };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.cspNonce;

  return (
    <html lang="sv">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#F2F5F4" />
        <Meta />
        <Links />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Hoppa till innehållet
        </a>
        <MotionConfig reducedMotion="user">
          <ToastProvider>{children}</ToastProvider>
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
  let message = "Något gick fel";
  let details = "Ett oväntat fel inträffade. Ladda om sidan och försök igen.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = "Sidan finns inte";
      details = "Sidan du letar efter finns inte, eller så har den flyttats.";
    } else {
      message = "Något gick fel";
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
        Ladda om sidan
      </button>
      {stack && (
        <pre className="rounded-card border-line bg-paper text-meta mt-4 w-full overflow-x-auto border p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
