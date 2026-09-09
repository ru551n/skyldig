import { randomBytes } from "node:crypto";

import type { Response } from "express";
import helmet from "helmet";

import type { Config } from "../config.ts";

/** Generates a fresh per-request CSP nonce (16 random bytes, base64-encoded). */
export function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Assigns a fresh CSP nonce to `res.locals.cspNonce` for every request, before helmet's CSP
 * middleware runs (its directive function below reads it back off `res.locals`), and before the
 * React Router request handler, which copies it onto the load context so the HTML can use the
 * same value (see `server/http/app.ts`).
 */
export function assignCspNonce(_req: unknown, res: Response, next: () => void): void {
  res.locals.cspNonce = generateNonce();
  next();
}

/**
 * Builds the helmet middleware implementing the CSP and remaining security headers from
 * docs/architecture.md §4.4: a per-request script nonce, `frame-ancestors 'none'`, HSTS in
 * production, a strict referrer policy, and nosniff. Must run after {@link assignCspNonce}.
 */
export function buildSecurityMiddleware(config: Pick<Config, "cookieSecure">) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce as string}'`],
        // 'unsafe-inline' is required: verified against a production build (`pnpm build` +
        // `node server.js`) driven through a real Chromium via Playwright — opening the Radix
        // Dialog used by app/components/ui/Dialog.tsx (e.g. the "leave group" confirmation)
        // triggers `motion`'s exit-animation cleanup, which does a full `style.cssText` reset
        // rather than a CSSOM per-property assignment; that reset is a `style-src-elem`
        // violation without this. Tailwind v4's own output is a static stylesheet and needs no
        // inline allowance, but the animation library does.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // frame-ancestors 'none' already blocks framing in modern browsers; X-Frame-Options is kept
    // as defense in depth for older ones.
    frameguard: { action: "deny" },
    hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
}
