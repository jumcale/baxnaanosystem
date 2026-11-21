import { prisma } from '../config/db';
import { redactSensitiveData } from '../middleware/logger';

export interface AuditLogEntry {
  branchId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldData?: unknown;
  newData?: unknown;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Persists an immutable security/financial audit trail record.
 * Automatically strips passwords, hashes, tokens, secrets, and raw photo blobs.
 */
export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const safeOld = entry.oldData
      ? redactSensitiveData(JSON.parse(JSON.stringify(entry.oldData)))
      : undefined;
    const safeNew = entry.newData
      ? redactSensitiveData(JSON.parse(JSON.stringify(entry.newData)))
      : undefined;

    await prisma.auditLog.create({
      data: {
        branchId: entry.branchId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: String(entry.entityId).slice(0, 128),
        oldData: safeOld,
        newData: safeNew,
        reason: entry.reason ? String(entry.reason).slice(0, 500) : undefined,
        ipAddress: entry.ipAddress ? String(entry.ipAddress).slice(0, 64) : undefined,
        userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 255) : undefined,
      },
    });
  } catch (error) {
    console.error('[AuditLog] Failed to write audit entry:', error);
  }
}
