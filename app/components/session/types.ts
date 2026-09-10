/** Serialized (loader-safe) shapes shared by the session shell and its child routes. */

export interface LayoutParticipant {
  publicId: string;
  displayName: string;
  position: number;
}

export interface LayoutBalanceEntry {
  publicId: string;
  displayName: string;
  paid: string;
  share: string;
  repaid: string;
  received: string;
  net: string;
}

export interface LayoutTransfer {
  from: { publicId: string; displayName: string };
  to: { publicId: string; displayName: string };
  amountMinor: string;
}

export interface LayoutSession {
  publicId: string;
  name: string;
  baseCurrency: string;
  expiresAt: string;
}

export interface SessionLayoutData {
  session: LayoutSession;
  role: "member" | "admin";
  /** True for an admin grant even after its elevation has lapsed, so the Admin page — the
   *  only place to re-enter the admin key or delete the group — stays reachable. */
  showAdminNav: boolean;
  participants: LayoutParticipant[];
  balances: {
    baseCurrency: string;
    balances: LayoutBalanceEntry[];
    transfers: LayoutTransfer[];
  };
}

/** Route id of `routes/session/layout.tsx`, for `useRouteLoaderData`. */
export const SESSION_LAYOUT_ROUTE_ID = "routes/session/layout";

/** True when fewer than 14 days remain until `expiresAt`. */
export function isExpiringSoon(expiresAt: string): boolean {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  return remainingMs < 14 * 24 * 60 * 60 * 1000;
}
