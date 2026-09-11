/**
 * Everything the admin app reads or does, through the admin role's views and functions
 * (drizzle/0006_admin_schema.sql). There is deliberately nothing here that could return a group's
 * name or contents: the role has no access to the tables that hold them.
 */
import type pg from "pg";

const n = (value: unknown): number => Number(value ?? 0);

export interface Overview {
  activeGroups: number;
  groupsCreated1d: number;
  groupsCreated7d: number;
  groupsCreated30d: number;
  groupsExpiring7d: number;
  participantsActive: number;
  browsersJoined: number;
  browsersActive30d: number;
  expensesTotal: number;
  expenses30d: number;
  expensesForeign: number;
  paymentsTotal: number;
  openInvites: number;
  databaseBytes: number;
}

export async function loadOverview(pool: pg.Pool): Promise<Overview> {
  const { rows } = await pool.query("SELECT * FROM admin.overview");
  const r = rows[0] ?? {};
  return {
    activeGroups: n(r.active_groups),
    groupsCreated1d: n(r.groups_created_1d),
    groupsCreated7d: n(r.groups_created_7d),
    groupsCreated30d: n(r.groups_created_30d),
    groupsExpiring7d: n(r.groups_expiring_7d),
    participantsActive: n(r.participants_active),
    browsersJoined: n(r.browsers_joined),
    browsersActive30d: n(r.browsers_active_30d),
    expensesTotal: n(r.expenses_total),
    expenses30d: n(r.expenses_30d),
    expensesForeign: n(r.expenses_foreign),
    paymentsTotal: n(r.payments_total),
    openInvites: n(r.open_invites),
    databaseBytes: n(r.database_bytes),
  };
}

export interface DayActivity {
  day: Date;
  groups: number;
  expenses: number;
  payments: number;
  joins: number;
}

export async function loadDailyActivity(pool: pg.Pool): Promise<DayActivity[]> {
  const { rows } = await pool.query("SELECT * FROM admin.daily_activity");
  return rows.map((r) => ({
    day: new Date(r.day),
    groups: n(r.groups_created),
    expenses: n(r.expenses_created),
    payments: n(r.payments_created),
    joins: n(r.joins),
  }));
}

export async function loadGroupSizes(pool: pg.Pool): Promise<{ bucket: string; groups: number }[]> {
  const { rows } = await pool.query("SELECT bucket, groups FROM admin.group_sizes");
  return rows.map((r) => ({ bucket: String(r.bucket), groups: n(r.groups) }));
}

export async function loadCurrencyMix(pool: pg.Pool): Promise<{ currency: string; groups: number }[]> {
  const { rows } = await pool.query("SELECT currency, groups FROM admin.currency_mix");
  return rows.map((r) => ({ currency: String(r.currency), groups: n(r.groups) }));
}

export interface MaintenanceRun {
  startedAt: Date;
  trigger: "schedule" | "admin";
  actor: string | null;
  sessionsDeleted: number;
  browserSessionsDeleted: number;
  invitesDeleted: number;
  skipped: boolean;
}

export async function loadRecentRuns(pool: pg.Pool): Promise<MaintenanceRun[]> {
  const { rows } = await pool.query("SELECT * FROM admin.recent_runs");
  return rows.map((r) => ({
    startedAt: new Date(r.started_at),
    trigger: r.trigger,
    actor: r.actor,
    sessionsDeleted: n(r.sessions_deleted),
    browserSessionsDeleted: n(r.browser_sessions_deleted),
    invitesDeleted: n(r.invites_deleted),
    skipped: Boolean(r.skipped),
  }));
}

export async function loadCleanupStatus(pool: pg.Pool): Promise<{ pendingSince: Date | null; lastRunAt: Date | null }> {
  const { rows } = await pool.query("SELECT pending_since, last_run_at FROM admin.cleanup_status");
  const r = rows[0] ?? {};
  return {
    pendingSince: r.pending_since ? new Date(r.pending_since) : null,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at) : null,
  };
}

export interface AuditEntry {
  at: Date;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export async function loadRecentAudit(pool: pg.Pool): Promise<AuditEntry[]> {
  const { rows } = await pool.query("SELECT at, actor, action, target, detail FROM admin.recent_audit");
  return rows.map((r) => ({ at: new Date(r.at), actor: r.actor, action: r.action, target: r.target, detail: r.detail }));
}

export interface GroupMetadata {
  createdAt: Date;
  expiresAt: Date;
  participants: number;
  expenses: number;
  payments: number;
  lastActivity: Date | null;
}

export async function loadGroupMetadata(pool: pg.Pool, publicId: string): Promise<GroupMetadata | null> {
  const { rows } = await pool.query("SELECT * FROM admin.group_metadata($1)", [publicId]);
  const r = rows[0];
  if (!r) return null;
  return {
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    participants: n(r.participants),
    expenses: n(r.expenses),
    payments: n(r.payments),
    lastActivity: r.last_activity ? new Date(r.last_activity) : null,
  };
}

export async function deleteGroup(pool: pg.Pool, publicId: string, actor: string, reason: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT admin.delete_group($1, $2, $3) AS deleted", [publicId, actor, reason]);
  return Boolean(rows[0]?.deleted);
}

export async function requestCleanup(pool: pg.Pool, actor: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT admin.request_cleanup($1) AS requested", [actor]);
  return Boolean(rows[0]?.requested);
}
