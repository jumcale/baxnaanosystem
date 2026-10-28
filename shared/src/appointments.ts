// ============================================================================
// BAXNAANO SHARED PHASE 5 SCHEMAS:
// APPOINTMENTS (BALLAMAHA - PHARMACY CONSULTATIONS & VET HERD/FARM VISITS)
// & STAFF TASKS
// ============================================================================

import { z } from 'zod';
import { SPECIES_ENUM } from './inventory';

export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'DONE',
  'CANCELLED',
  'NO_SHOW',
] as const;

export type AppointmentStatusType = (typeof APPOINTMENT_STATUSES)[number];

export const VISIT_TYPES = [
  'CLINIC_VISIT',
  'FARM_VISIT',
  'CONSULTATION',
] as const;

export type VisitTypeEnum = (typeof VISIT_TYPES)[number];

export const TASK_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TaskStatusType = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const;

export type TaskPriorityType = (typeof TASK_PRIORITIES)[number];

export const CreateAppointmentSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  customerId: z.string().uuid().optional().nullable(),
  assignedStaffId: z.string().uuid().optional().nullable(),
  patientOrOwner: z.string().min(2).max(120),
  phone: z.string().min(6).max(30),
  status: z.enum(APPOINTMENT_STATUSES).default('BOOKED'),
  visitType: z.enum(VISIT_TYPES).default('CLINIC_VISIT'),
  scheduledAt: z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Invalid scheduledAt date',
  }),

  // Pharmacy Specific (B1 - Human Health Consultations)
  patientAge: z.coerce.number().int().nonnegative().optional().nullable(),
  patientGender: z.string().max(20).optional().nullable(),
  symptoms: z.string().max(500).optional().nullable(),

  // Veterinary Specific (B2 Arabsiyo & B3 Gabiley - Livestock Health)
  species: z.enum(SPECIES_ENUM).optional().nullable(),
  animalCount: z.coerce.number().int().positive().optional().nullable(),
  villageOrFarm: z.string().max(150).optional().nullable(),

  // Shared Clinical / Prescription / Treatment Notes
  diagnosis: z.string().max(500).optional().nullable(),
  treatmentNotes: z.string().max(1000).optional().nullable(),
  prescriptionText: z.string().max(1000).optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  reminderSent: z.boolean().default(false),
});

export const UpdateAppointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  diagnosis: z.string().max(500).optional().nullable(),
  treatmentNotes: z.string().max(1000).optional().nullable(),
  prescriptionText: z.string().max(1000).optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  reminderSent: z.boolean().optional(),
});

export const CreateTaskSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  title: z.string().min(2).max(150),
  description: z.string().max(500).optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  status: z.enum(TASK_STATUSES).default('OPEN'),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  dueDate: z.string().optional().nullable(),
  relatedEntityId: z.string().optional().nullable(),
});

export const UpdateTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  assignedToId: z.string().uuid().optional().nullable(),
});
