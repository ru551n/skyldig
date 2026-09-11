/**
 * Who may use the admin app. Authentik (via Caddy's forward_auth) signs the operator in and
 * passes their identity in X-authentik-* headers — but headers are trivially forged by anyone who
 * can reach this server directly, so they are only believed on connections from the reverse proxy
 * itself, identified by its IP address on the socket (never by X-Forwarded-For).
 */
import type { IncomingHttpHeaders } from "node:http";

export interface AdminIdentity {
  username: string;
}

/** `::ffff:10.0.0.5` (an IPv4 address on an IPv6 socket) → `10.0.0.5`. */
export function normalizeIp(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

export function isTrustedPeer(remoteAddress: string | undefined, trustedProxies: readonly string[]): boolean {
  const ip = normalizeIp(remoteAddress);
  return ip !== "" && trustedProxies.map(normalizeIp).includes(ip);
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * The signed-in operator, or null. Requires a username and membership of `requiredGroup` in the
 * groups header, which Authentik sends pipe-separated (`admins|skyldig-admins`).
 */
export function identityFromHeaders(headers: IncomingHttpHeaders, requiredGroup: string): AdminIdentity | null {
  const username = header(headers, "x-authentik-username");
  if (!username || username.length > 200) return null;
  const groups = header(headers, "x-authentik-groups")
    .split("|")
    .map((group) => group.trim());
  if (!groups.includes(requiredGroup)) return null;
  return { username };
}

/** A group's public ID: 16 characters from generatePublicId's alphabet (no 0, 1, l or o). */
const ID = "[a-km-np-z2-9]{16}";
const PUBLIC_ID = new RegExp(`^${ID}$`);
const GROUP_PATH = new RegExp(`^/s/(${ID})(/|$)`);

/** A group ID typed or pasted as-is, or taken from a group link (…/s/<id>/…). */
export function parseGroupId(input: string): string | null {
  const trimmed = input.trim();
  if (PUBLIC_ID.test(trimmed)) return trimmed;
  try {
    const match = GROUP_PATH.exec(new URL(trimmed).pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
