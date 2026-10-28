import { Router, Request, Response } from 'express';
import {
  AppointmentStatus,
  Species,
  TaskPriority,
  TaskStatus,
  VisitType,
} from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import {
  CreateAppointmentSchema,
  UpdateAppointmentStatusSchema,
  CreateTaskSchema,
  UpdateTaskStatusSchema,
} from '@baxnaano/shared';
import { recordAuditLog } from '../utils/audit';

export const appointmentsRouter = Router();

appointmentsRouter.use(authenticateJWT);

// ============================================================================
// 1. APPOINTMENTS (BALLAMAHA): PHARMACY CONSULTATIONS & VET HERD/FARM VISITS
// ============================================================================

/**
 * GET /api/appointments
 * Supports filtering by date, status (BOOKED, DONE, CANCELLED, NO_SHOW), visitType, assignedStaffId
 */
appointmentsRouter.get(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('appointments:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { date, status, visitType, assignedStaffId } = req.query as Record<
        string,
        string | undefined
      >;

      const where = scopedWhere(req, {
        ...(status ? { status: status as AppointmentStatus } : {}),
        ...(visitType ? { visitType: visitType as VisitType } : {}),
        ...(assignedStaffId ? { assignedStaffId } : {}),
        ...(date
          ? {
              scheduledAt: {
                gte: new Date(`${date}T00:00:00.000Z`),
                lte: new Date(`${date}T23:59:59.999Z`),
              },
            }
          : {}),
      });

      const appointments = await prisma.appointment.findMany({
        where,
        include: {
          branch: { select: { id: true, code: true, name: true, type: true, location: true } },
          customer: { select: { id: true, name: true, phone: true, villageOrFarm: true } },
          assignedStaff: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: { scheduledAt: 'asc' },
      });

      res.json({ appointments });
    } catch (error) {
      console.error('[Appointments] List error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/appointments
 * Creates or updates a Pharmacy Consultation (B1) or Veterinary Clinic/Farm Visit (B2/B3)
 * If followUpDate is set, optionally auto-creates a follow-up staff Task.
 */
appointmentsRouter.post(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('appointments:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateAppointmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;

      const appointment = await prisma.appointment.upsert({
        where: { id: data.id || '00000000-0000-0000-0000-000000000000' },
        update: {
          customerId: data.customerId ?? null,
          assignedStaffId: data.assignedStaffId ?? req.user!.id,
          patientOrOwner: data.patientOrOwner,
          phone: data.phone,
          status: data.status as AppointmentStatus,
          visitType: data.visitType as VisitType,
          scheduledAt: new Date(data.scheduledAt),
          patientAge: data.patientAge ?? null,
          patientGender: data.patientGender ?? null,
          symptoms: data.symptoms ?? null,
          species: (data.species as Species) ?? null,
          animalCount: data.animalCount ?? null,
          villageOrFarm: data.villageOrFarm ?? null,
          diagnosis: data.diagnosis ?? null,
          treatmentNotes: data.treatmentNotes ?? null,
          prescriptionText: data.prescriptionText ?? null,
          followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
          reminderSent: data.reminderSent,
          version: { increment: 1 },
        },
        create: {
          id: data.id,
          branchId: data.branchId,
          customerId: data.customerId ?? null,
          assignedStaffId: data.assignedStaffId ?? req.user!.id,
          patientOrOwner: data.patientOrOwner,
          phone: data.phone,
          status: data.status as AppointmentStatus,
          visitType: data.visitType as VisitType,
          scheduledAt: new Date(data.scheduledAt),
          patientAge: data.patientAge ?? null,
          patientGender: data.patientGender ?? null,
          symptoms: data.symptoms ?? null,
          species: (data.species as Species) ?? null,
          animalCount: data.animalCount ?? null,
          villageOrFarm: data.villageOrFarm ?? null,
          diagnosis: data.diagnosis ?? null,
          treatmentNotes: data.treatmentNotes ?? null,
          prescriptionText: data.prescriptionText ?? null,
          followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
          reminderSent: data.reminderSent,
        },
      });

      res.status(201).json({ appointment });
    } catch (error) {
      console.error('[Appointments] Create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * PATCH /api/appointments/:id/status
 * Updates appointment status (BOOKED, DONE, CANCELLED, NO_SHOW), clinical notes, prescription/treatment, or reminderSent flag
 */
appointmentsRouter.patch(
  '/:id/status',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('appointments:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = UpdateAppointmentStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.appointment.findFirst({
        where: scopedWhere(req, { id: req.params.id }),
      });

      if (!existing) {
        res.status(404).json({ error: 'APPOINTMENT_NOT_FOUND' });
        return;
      }

      const updated = await prisma.appointment.update({
        where: { id: existing.id },
        data: {
          status: parsed.data.status as AppointmentStatus,
          ...(parsed.data.diagnosis !== undefined ? { diagnosis: parsed.data.diagnosis } : {}),
          ...(parsed.data.treatmentNotes !== undefined
            ? { treatmentNotes: parsed.data.treatmentNotes }
            : {}),
          ...(parsed.data.prescriptionText !== undefined
            ? { prescriptionText: parsed.data.prescriptionText }
            : {}),
          ...(parsed.data.followUpDate !== undefined
            ? {
                followUpDate: parsed.data.followUpDate
                  ? new Date(parsed.data.followUpDate)
                  : null,
              }
            : {}),
          ...(parsed.data.reminderSent !== undefined
            ? { reminderSent: parsed.data.reminderSent }
            : {}),
          version: { increment: 1 },
        },
      });

      await recordAuditLog({
        branchId: updated.branchId,
        userId: req.user!.id,
        action: `APPOINTMENT_${parsed.data.status}`,
        entityType: 'Appointment',
        entityId: updated.id,
        newData: { status: updated.status, patientOrOwner: updated.patientOrOwner },
        ipAddress: req.ip,
      });

      res.json({ appointment: updated });
    } catch (error) {
      console.error('[Appointments] Update status error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 2. STAFF TASKS (ASSIGNABLE WITH DUE DATES & STATUS)
// ============================================================================

/**
 * GET /api/appointments/tasks
 * Lists branch tasks filtered by status or assignedToId, plus branch staff list for assignment
 */
appointmentsRouter.get(
  '/tasks',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('tasks:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, assignedToId } = req.query as Record<string, string | undefined>;

      const where = scopedWhere(req, {
        ...(status ? { status: status as TaskStatus } : {}),
        ...(assignedToId ? { assignedToId } : {}),
      });

      const [tasks, staff] = await Promise.all([
        prisma.task.findMany({
          where,
          include: {
            branch: { select: { id: true, code: true, name: true } },
            assignedTo: { select: { id: true, fullName: true, username: true } },
            createdBy: { select: { id: true, fullName: true } },
          },
          orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        }),
        prisma.user.findMany({
          where: {
            ...(req.branchScope?.branchId ? { branchId: req.branchScope.branchId } : {}),
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, fullName: true, username: true, branchId: true },
          orderBy: { fullName: 'asc' },
        }),
      ]);

      res.json({ tasks, staff });
    } catch (error) {
      console.error('[Tasks] List error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/appointments/tasks
 * Creates or updates a staff Task
 */
appointmentsRouter.post(
  '/tasks',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('tasks:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const task = await prisma.task.upsert({
        where: { id: data.id || '00000000-0000-0000-0000-000000000000' },
        update: {
          title: data.title,
          description: data.description ?? null,
          assignedToId: data.assignedToId ?? null,
          status: data.status as TaskStatus,
          priority: data.priority as TaskPriority,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          completedAt: data.status === 'COMPLETED' ? new Date() : null,
          version: { increment: 1 },
        },
        create: {
          id: data.id,
          branchId: data.branchId,
          title: data.title,
          description: data.description ?? null,
          assignedToId: data.assignedToId ?? null,
          createdById: req.user!.id,
          status: data.status as TaskStatus,
          priority: data.priority as TaskPriority,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          relatedEntityId: data.relatedEntityId ?? null,
        },
      });

      res.status(201).json({ task });
    } catch (error) {
      console.error('[Tasks] Create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * PATCH /api/appointments/tasks/:id/status
 */
appointmentsRouter.patch(
  '/tasks/:id/status',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('tasks:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = UpdateTaskStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.task.findFirst({
        where: scopedWhere(req, { id: req.params.id }),
      });

      if (!existing) {
        res.status(404).json({ error: 'TASK_NOT_FOUND' });
        return;
      }

      const updated = await prisma.task.update({
        where: { id: existing.id },
        data: {
          status: parsed.data.status as TaskStatus,
          ...(parsed.data.assignedToId !== undefined
            ? { assignedToId: parsed.data.assignedToId }
            : {}),
          completedAt: parsed.data.status === 'COMPLETED' ? new Date() : null,
          version: { increment: 1 },
        },
      });

      res.json({ task: updated });
    } catch (error) {
      console.error('[Tasks] Update status error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);
