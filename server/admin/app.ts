/**
 * The operator admin app: a separate process on its own hostname behind Caddy + Authentik.
 * Privacy first — it can only show counts and dates and perform three narrow actions, because its
 * database role cannot reach anything else (drizzle/0006_admin_schema.sql).
 */
import express, { type NextFunction, type Request, type Response } from "express";
import type pg from "pg";

import { identityFromHeaders, isTrustedPeer, normalizeIp, parseGroupId, type AdminIdentity } from "./auth.ts";
import type { AdminConfig } from "./config.ts";
import { STYLES, barChart, formatters, href, html, notice, page, table, tile, type Section, type SafeHtml } from "./html.ts";
import { messages, resolveAdminLocale, type AdminLocale, type AdminMessages } from "./i18n.ts";
import {
  deleteGroup,
  loadCleanupStatus,
  loadCurrencyMix,
  loadDailyActivity,
  loadGroupMetadata,
  loadGroupSizes,
  loadOverview,
  loadRecentAudit,
  loadRecentRuns,
  requestCleanup,
} from "./queries.ts";

interface Locals {
  identity: AdminIdentity;
  locale: AdminLocale;
  t: AdminMessages;
}

export interface AdminAppDeps {
  pool: pg.Pool;
  config: AdminConfig;
  /** Injected so tests can stub the main app's /ready check. */
  fetchImpl?: typeof fetch;
  onError?: (error: unknown) => void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const LOOPBACK = ["127.0.0.1", "::1"];

export function createAdminApp({ pool, config, fetchImpl = fetch, onError = () => {} }: AdminAppDeps) {
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    next();
  });

  // Container healthcheck, from inside the container only; reveals nothing.
  app.get("/healthz", (req, res) => {
    if (!LOOPBACK.includes(normalizeIp(req.socket.remoteAddress))) return void res.status(404).end();
    res.type("text/plain").send("ok");
  });

  // Who is asking. The Authentik headers are only believed on connections from the reverse proxy.
  app.use((req, res, next) => {
    const locale = resolveAdminLocale(req.query.lang, req.headers["accept-language"]);
    const t = messages(locale);
    const identity = isTrustedPeer(req.socket.remoteAddress, config.trustedProxies)
      ? identityFromHeaders(req.headers, config.requiredGroup)
      : null;
    if (!identity) return void res.status(403).type("text/plain").send(t.forbidden);
    Object.assign(res.locals, { identity, locale, t } satisfies Locals);
    next();
  });

  app.get("/style.css", (_req, res) => {
    res.type("text/css").send(STYLES);
  });

  app.use(express.urlencoded({ extended: false, limit: "10kb", parameterLimit: 20 }));

  // Forms must come from the admin site itself: a page elsewhere could otherwise make a signed-in
  // operator's browser post here with their Authentik session.
  app.use((req, res, next) => {
    if (req.method === "POST" && req.headers.origin !== config.publicOrigin) {
      const { t } = res.locals as Locals;
      return void res.status(403).type("text/plain").send(t.badOrigin);
    }
    next();
  });

  function send(res: Response, section: Section | null, title: string, path: string, content: SafeHtml, status = 200) {
    const { identity, locale, t } = res.locals as Locals;
    res.status(status).type("html").send(page({ t, locale, user: identity.username, active: section, title, path, content }));
  }

  async function appStatus(t: AdminMessages): Promise<SafeHtml> {
    if (!config.appInternalUrl) return html`${t.overview.appUnknown}`;
    try {
      const response = await fetchImpl(new URL("/ready", config.appInternalUrl), { signal: AbortSignal.timeout(2000) });
      return response.ok ? html`<span class="ok">${t.overview.appReady}</span>` : html`<span class="bad">${t.overview.appDown}</span>`;
    } catch {
      return html`<span class="bad">${t.overview.appDown}</span>`;
    }
  }

  app.get("/", async (_req, res, next) => {
    try {
      const { locale, t } = res.locals as Locals;
      const f = formatters(locale, config.timeZone);
      const o = t.overview;
      const [overview, activity, sizes, currencies, status] = await Promise.all([
        loadOverview(pool),
        loadDailyActivity(pool),
        loadGroupSizes(pool),
        loadCurrencyMix(pool),
        appStatus(t),
      ]);
      const days = activity.map((d) => f.date(d.day));
      const foreign = overview.expensesTotal ? overview.expensesForeign / overview.expensesTotal : 0;
      const content = html`
<section aria-label="${o.title}" class="tiles">
  ${tile(o.activeGroups, f.number(overview.activeGroups))}
  ${tile(o.newGroups, f.number(overview.groupsCreated30d), `${o.last30} · ${o.newGroupsDetail({ d1: f.number(overview.groupsCreated1d), d7: f.number(overview.groupsCreated7d) })}`)}
  ${tile(o.expiring, f.number(overview.groupsExpiring7d))}
  ${tile(o.participants, f.number(overview.participantsActive), o.participantsHint)}
  ${tile(o.browsersJoined, f.number(overview.browsersJoined), o.browsersJoinedHint)}
  ${tile(o.browsersActive, f.number(overview.browsersActive30d), o.browsersActiveHint)}
  ${tile(o.expenses, f.number(overview.expensesTotal), `${o.expensesDetail({ d30: f.number(overview.expenses30d) })} · ${o.foreignShare({ share: f.percent(foreign) })}`)}
  ${tile(o.payments, f.number(overview.paymentsTotal))}
  ${tile(o.invites, f.number(overview.openInvites))}
  ${tile(o.database, f.bytes(overview.databaseBytes))}
</section>
<p>${o.appStatus} ${status}</p>
<h2>${o.activity}</h2>
<div class="charts">
  ${barChart(o.groupsCreated, days, activity.map((d) => d.groups), f)}
  ${barChart(o.expensesCreated, days, activity.map((d) => d.expenses), f)}
  ${barChart(o.joins, days, activity.map((d) => d.joins), f)}
</div>
<details>
  <summary>${o.tableFallback}</summary>
  ${table(null, [o.day, o.groupsCreated, o.expensesCreated, t.overview.joins], activity.map((d, i) => [days[i]!, f.number(d.groups), f.number(d.expenses), f.number(d.joins)]))}
</details>
<h2>${o.sizes}</h2>
${sizes.length ? table(null, [o.sizeColumn, o.groups], sizes.map((s) => [o.sizePeople({ bucket: s.bucket }), f.number(s.groups)])) : html`<p>${o.none}</p>`}
<h2>${o.currencies}</h2>
${currencies.length ? table(null, [o.currency, o.groups], currencies.map((c) => [c.currency, f.number(c.groups)])) : html`<p>${o.none}</p>`}`;
      send(res, "overview", o.title, "/", content);
    } catch (error) {
      next(error);
    }
  });

  app.get("/underhall", async (req, res, next) => {
    try {
      const { locale, t } = res.locals as Locals;
      const m = t.maintenance;
      const f = formatters(locale, config.timeZone);
      const [status, runs] = await Promise.all([loadCleanupStatus(pool), loadRecentRuns(pool)]);
      const flash = req.query.status === "requested" ? notice(m.requested) : req.query.status === "pending" ? notice(m.alreadyPending) : null;
      const content = html`
<p class="lead">${m.lead}</p>
${flash}
<div class="card">
  <p>${m.lastRun}: ${status.lastRunAt ? f.dateTime(status.lastRunAt) : m.never}</p>
  ${status.pendingSince ? html`<p>${m.pending({ since: f.dateTime(status.pendingSince) })}</p>` : ""}
  <form method="post" action="${href("/underhall/rensa", locale)}">
    <button type="submit">${m.requestButton}</button>
  </form>
</div>
<h2>${m.history}</h2>
${runs.length
  ? table(null, [m.when, m.trigger, m.groups, m.browsers, m.invites, m.skipped], runs.map((r) => [
      f.dateTime(r.startedAt),
      r.trigger === "admin" ? m.admin({ who: r.actor ?? "?" }) : m.schedule,
      f.number(r.sessionsDeleted),
      f.number(r.browserSessionsDeleted),
      f.number(r.invitesDeleted),
      r.skipped ? m.yes : m.no,
    ]))
  : html`<p>${m.never}</p>`}`;
      send(res, "maintenance", m.title, "/underhall", content);
    } catch (error) {
      next(error);
    }
  });

  app.post("/underhall/rensa", async (_req, res, next) => {
    try {
      const { identity, locale } = res.locals as Locals;
      const requested = await requestCleanup(pool, identity.username);
      res.redirect(303, href("/underhall", locale, { status: requested ? "requested" : "pending" }));
    } catch (error) {
      next(error);
    }
  });

  async function groupPage(res: Response, rawId: string, extra: { flash?: SafeHtml; status?: number; reason?: string } = {}) {
    const { locale, t } = res.locals as Locals;
    const g = t.group;
    const f = formatters(locale, config.timeZone);
    const id = rawId ? parseGroupId(rawId) : null;
    const meta = id ? await loadGroupMetadata(pool, id) : null;
    const result = !rawId
      ? ""
      : !id
        ? notice(g.invalid, "error")
        : !meta
          ? notice(g.notFound)
          : html`
<div class="card">
  <dl class="meta">
    <dt>${g.created}</dt><dd>${f.dateTime(meta.createdAt)}</dd>
    <dt>${g.expires}</dt><dd>${f.dateTime(meta.expiresAt)}</dd>
    <dt>${g.participants}</dt><dd>${f.number(meta.participants)}</dd>
    <dt>${g.expenses}</dt><dd>${f.number(meta.expenses)}</dd>
    <dt>${g.payments}</dt><dd>${f.number(meta.payments)}</dd>
    <dt>${g.lastActivity}</dt><dd>${meta.lastActivity ? f.dateTime(meta.lastActivity) : "–"}</dd>
  </dl>
</div>
<h2>${g.deleteTitle}</h2>
<div class="card danger-zone">
  <p>${g.deleteLead}</p>
  <form method="post" action="${href("/grupp/radera", locale)}">
    <input type="hidden" name="id" value="${id}">
    <label for="reason">${g.reason} <span class="hint">${g.reasonHint}</span></label>
    <textarea id="reason" name="reason" required maxlength="500">${extra.reason ?? ""}</textarea>
    <label for="confirm">${g.confirm}: <code>${id}</code></label>
    <input id="confirm" name="confirm" required autocomplete="off" spellcheck="false">
    <button type="submit" class="danger">${g.deleteButton}</button>
  </form>
</div>`;
    const content = html`
<p class="lead">${g.lead}</p>
${extra.flash ?? ""}
<form method="get" action="/grupp">
  <input type="hidden" name="lang" value="${locale}">
  <label for="id">${g.idLabel}</label>
  <input id="id" name="id" value="${rawId}" required autocomplete="off" spellcheck="false">
  <button type="submit">${g.search}</button>
</form>
${result}`;
    send(res, "group", g.title, "/grupp", content, extra.status);
  }

  app.get("/grupp", async (req, res, next) => {
    try {
      const { t } = res.locals as Locals;
      const flash = req.query.status === "deleted" ? notice(t.group.deleted) : undefined;
      await groupPage(res, typeof req.query.id === "string" ? req.query.id : "", { flash });
    } catch (error) {
      next(error);
    }
  });

  app.post("/grupp/radera", async (req, res, next) => {
    try {
      const { identity, locale, t } = res.locals as Locals;
      const body = req.body as Record<string, unknown>;
      const id = typeof body.id === "string" ? parseGroupId(body.id) : null;
      const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (!id) return void (await groupPage(res, "", { flash: notice(t.group.invalid, "error"), status: 400 }));
      if (!reason) return void (await groupPage(res, id, { flash: notice(t.group.reasonRequired, "error"), status: 400 }));
      if (confirm !== id) {
        return void (await groupPage(res, id, { flash: notice(t.group.confirmMismatch, "error"), status: 400, reason }));
      }
      await deleteGroup(pool, id, identity.username, reason);
      res.redirect(303, href("/grupp", locale, { status: "deleted" }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/logg", async (_req, res, next) => {
    try {
      const { locale, t } = res.locals as Locals;
      const l = t.log;
      const f = formatters(locale, config.timeZone);
      const entries = await loadRecentAudit(pool);
      const content = html`
<p class="lead">${l.lead}</p>
${entries.length
  ? table(null, [l.when, l.who, l.action, l.target, l.detail], entries.map((e) => [
      f.dateTime(e.at),
      e.actor,
      l.actions[e.action] ?? e.action,
      e.target ?? "–",
      e.detail ?? "–",
    ]))
  : html`<p>${t.overview.none}</p>`}`;
      send(res, "log", l.title, "/logg", content);
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => {
    const { t } = res.locals as Locals;
    send(res, null, t.notFoundPage, "/", html``, 404);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    onError(error);
    res.status(500).type("text/plain").send("Internal error");
  });

  return app;
}
