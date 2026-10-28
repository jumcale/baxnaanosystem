import { v4 as uuidv4 } from 'uuid';
import { db, enqueueOfflineSyncItem } from '../db/dexie';
import {
  AppointmentStatusType,
  VisitTypeEnum,
  SpeciesType,
  TaskStatusType,
  TaskPriorityType,
} from '@baxnaano/shared';

export interface OfflineAppointmentRecord {
  id: string;
  branchId: string;
  customerId?: string | null;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  patientOrOwner: string;
  phone: string;
  status: AppointmentStatusType;
  visitType: VisitTypeEnum;
  scheduledAt: string;
  // Pharmacy B1
  patientAge?: number | null;
  patientGender?: string | null;
  symptoms?: string | null;
  // Vet B2/B3
  species?: SpeciesType | null;
  animalCount?: number | null;
  villageOrFarm?: string | null;
  // Clinical Notes
  diagnosis?: string | null;
  treatmentNotes?: string | null;
  prescriptionText?: string | null;
  followUpDate?: string | null;
  reminderSent: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OfflineTaskRecord {
  id: string;
  branchId: string;
  title: string;
  description?: string | null;
  assignedToId?: string | null;
  assignedToName?: string | null;
  createdById: string;
  status: TaskStatusType;
  priority: TaskPriorityType;
  dueDate?: string | null;
  completedAt?: string | null;
  relatedEntityId?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export async function getOfflineAppointments(branchId: string): Promise<OfflineAppointmentRecord[]> {
  const list =
    branchId === 'ALL'
      ? await db.appointments.filter((a) => !a.deletedAt).toArray()
      : await db.appointments
          .where('branchId')
          .equals(branchId)
          .filter((a) => !a.deletedAt)
          .toArray();

  return (list as unknown as OfflineAppointmentRecord[]).sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}

export async function saveOfflineAppointment(
  input: Omit<OfflineAppointmentRecord, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
    id?: string;
  }
): Promise<OfflineAppointmentRecord> {
  const now = new Date().toISOString();
  const id = input.id || uuidv4();

  const record: OfflineAppointmentRecord = {
    ...input,
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.transaction('rw', [db.appointments, db.tasks, db.syncQueue], async () => {
    await db.appointments.put(record as unknown as OfflineAppointmentRecord & Record<string, unknown>);
    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: input.branchId,
      entityType: 'Appointment',
      entityId: id,
      operation: 'CREATE',
      payload: record as unknown as Record<string, unknown>,
      baseVersion: 1,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });

    // If a followUpDate is set, auto-create an open follow-up task for the assigned staff
    if (input.followUpDate) {
      const followUpTaskId = uuidv4();
      const taskRecord: OfflineTaskRecord = {
        id: followUpTaskId,
        branchId: input.branchId,
        title: `Follow-up: ${input.patientOrOwner} (${input.phone})`,
        description:
          input.treatmentNotes || input.prescriptionText || 'Scheduled clinical follow-up check',
        assignedToId: input.assignedStaffId ?? null,
        assignedToName: input.assignedStaffName ?? null,
        createdById: input.assignedStaffId || 'system',
        status: 'OPEN',
        priority: 'HIGH',
        dueDate: input.followUpDate,
        relatedEntityId: id,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      await db.tasks.put(taskRecord as unknown as OfflineTaskRecord & Record<string, unknown>);
      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: input.branchId,
        entityType: 'Task',
        entityId: followUpTaskId,
        operation: 'CREATE',
        payload: taskRecord as unknown as Record<string, unknown>,
        baseVersion: 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: now,
      });
    }
  });

  return record;
}

export async function updateOfflineAppointmentStatus(params: {
  appointmentId: string;
  status: AppointmentStatusType;
  diagnosis?: string | null;
  treatmentNotes?: string | null;
  prescriptionText?: string | null;
  followUpDate?: string | null;
  reminderSent?: boolean;
}) {
  const now = new Date().toISOString();
  await db.transaction('rw', [db.appointments, db.syncQueue], async () => {
    const existing = await db.appointments.get(params.appointmentId);
    if (!existing) throw new Error('APPOINTMENT_NOT_FOUND');

    const nextVersion = Number(existing.version || 1) + 1;
    const updates = {
      status: params.status,
      ...(params.diagnosis !== undefined ? { diagnosis: params.diagnosis } : {}),
      ...(params.treatmentNotes !== undefined ? { treatmentNotes: params.treatmentNotes } : {}),
      ...(params.prescriptionText !== undefined
        ? { prescriptionText: params.prescriptionText }
        : {}),
      ...(params.followUpDate !== undefined ? { followUpDate: params.followUpDate } : {}),
      ...(params.reminderSent !== undefined ? { reminderSent: params.reminderSent } : {}),
      version: nextVersion,
      updatedAt: now,
    };

    await db.appointments.update(params.appointmentId, updates);
    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: existing.branchId,
      entityType: 'AppointmentStatus',
      entityId: params.appointmentId,
      operation: 'UPDATE',
      payload: { appointmentId: params.appointmentId, ...updates },
      baseVersion: nextVersion,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });
}

export async function getOfflineTasks(branchId: string): Promise<OfflineTaskRecord[]> {
  const list =
    branchId === 'ALL'
      ? await db.tasks.filter((t) => !t.deletedAt).toArray()
      : await db.tasks
          .where('branchId')
          .equals(branchId)
          .filter((t) => !t.deletedAt)
          .toArray();

  return (list as unknown as OfflineTaskRecord[]).sort((a, b) => {
    if (a.status === 'COMPLETED' && b.status !== 'COMPLETED') return 1;
    if (a.status !== 'COMPLETED' && b.status === 'COMPLETED') return -1;
    return (
      new Date(a.dueDate || a.createdAt).getTime() -
      new Date(b.dueDate || b.createdAt).getTime()
    );
  });
}

export async function createOfflineTask(
  input: Omit<OfflineTaskRecord, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
    id?: string;
  }
): Promise<OfflineTaskRecord> {
  const now = new Date().toISOString();
  const id = input.id || uuidv4();
  const record: OfflineTaskRecord = {
    ...input,
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.transaction('rw', [db.tasks, db.syncQueue], async () => {
    await db.tasks.put(record as unknown as OfflineTaskRecord & Record<string, unknown>);
    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: input.branchId,
      entityType: 'Task',
      entityId: id,
      operation: 'CREATE',
      payload: record as unknown as Record<string, unknown>,
      baseVersion: 1,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });

  return record;
}

export async function updateOfflineTaskStatus(
  taskId: string,
  status: TaskStatusType
) {
  const now = new Date().toISOString();
  await db.transaction('rw', [db.tasks, db.syncQueue], async () => {
    const existing = await db.tasks.get(taskId);
    if (!existing) throw new Error('TASK_NOT_FOUND');

    const nextVersion = Number(existing.version || 1) + 1;
    await db.tasks.update(taskId, {
      status,
      completedAt: status === 'COMPLETED' ? now : null,
      version: nextVersion,
      updatedAt: now,
    });

    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: existing.branchId,
      entityType: 'TaskStatus',
      entityId: taskId,
      operation: 'UPDATE',
      payload: { taskId, status },
      baseVersion: nextVersion,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });
}

/**
 * Generates bilingual SMS and WhatsApp deep-links for appointment & follow-up reminders
 */
export function buildAppointmentReminderLinks(
  appt: OfflineAppointmentRecord,
  branchName: string,
  lang: 'en' | 'so' = 'en'
): { whatsappUrl: string; smsUrl: string; messageText: string } {
  const dateStr = new Date(appt.scheduledAt).toLocaleString();
  const phoneClean = appt.phone.replace(/[^0-9+]/g, '');

  const messageText =
    lang === 'so'
      ? `Xusuusin Ballan - ${branchName}: Mudane/Marwo ${appt.patientOrOwner}, ballantaada caafimaad waa ${dateStr}${
          appt.villageOrFarm ? ` (${appt.villageOrFarm})` : ''
        }. Fadlan nala soo xidhiidh haddii aad u baahan tahay macluumaad.`
      : `Appointment Reminder - ${branchName}: Dear ${appt.patientOrOwner}, your appointment is scheduled for ${dateStr}${
          appt.villageOrFarm ? ` (${appt.villageOrFarm})` : ''
        }.`;

  const encoded = encodeURIComponent(messageText);
  return {
    whatsappUrl: `https://wa.me/${phoneClean.replace('+', '')}?text=${encoded}`,
    smsUrl: `sms:${phoneClean}?body=${encoded}`,
    messageText,
  };
}
