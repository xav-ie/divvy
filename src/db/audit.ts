import type { Db } from "./connection.ts";
import { all, placeholders, run } from "./rows.ts";

export type AuditAction = "create" | "update" | "delete" | "restore";

export interface AuditEntry {
  id: number;
  groupId: number;
  userId: number;
  userName: string;
  action: AuditAction;
  /** "expense" or "payment" (other features may add more). */
  entity: string;
  entityId: number;
  /** Human sentence written at change time, e.g. `added "Dinner" ($133.12)`. */
  summary: string;
  created: string;
  /** The acting user's member id (null if they no longer have one). */
  actorMemberId: number | null;
  /** Payments: `{ fromMember, toMember, cents }`. */
  data: AuditData | null;
}

export interface AuditData {
  fromMember?: number;
  toMember?: number;
  cents?: number;
}

export function insertAudit(
  db: Db,
  a: Omit<
    AuditEntry,
    "id" | "userName" | "created" | "actorMemberId" | "data"
  > & { data?: AuditData },
): void {
  run(
    db,
    "INSERT INTO audit (group_id, user_id, action, entity, entity_id, summary, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    a.groupId,
    a.userId,
    a.action,
    a.entity,
    a.entityId,
    a.summary,
    a.data ? JSON.stringify(a.data) : null,
  );
}

/** Newest first across the given groups. */
export function listAudit(
  db: Db,
  groupIds: number[],
  limit: number,
): AuditEntry[] {
  if (groupIds.length === 0) return [];
  return all<Omit<AuditEntry, "data"> & { data: string | null }>(
    db,
    `SELECT a.id, a.group_id AS groupId, a.user_id AS userId, u.name AS userName, a.action, a.entity,
       a.entity_id AS entityId, a.summary, a.created, m.id AS actorMemberId, a.data
       FROM audit a JOIN users u ON u.id = a.user_id LEFT JOIN members m ON m.user_id = a.user_id
       WHERE a.group_id IN (${placeholders(groupIds.length)}) ORDER BY a.created DESC, a.id DESC LIMIT ?`,
    ...groupIds,
    limit,
  ).map((r) => ({
    ...r,
    data: r.data ? (JSON.parse(r.data) as AuditData) : null,
  }));
}
