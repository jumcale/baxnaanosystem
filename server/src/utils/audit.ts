import { prisma } from '../config/db';

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

export async function recordAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        branchId: entry.branchId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldData: entry.oldData ? JSON.parse(JSON.stringify(entry.oldData)) : undefined,
        newData: entry.newData ? JSON.parse(JSON.stringify(entry.newData)) : undefined,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  } catch (error) {
    console.error('[AuditLog] Failed to write audit entry:', error);
  }
}
