/**
 * Baxnaano Online-Only System
 * Authoritative Appointments & Tasks API
 */
import { apiClient } from './client';

export interface ServerAppointment {
  id: string;
  branchId: string;
  patientOrOwner: string;
  phone: string;
  scheduledAt: string;
  visitType: 'PHARMACY_CONSULTATION' | 'VET_CLINIC_VISIT' | 'VET_FARM_VISIT' | 'CONSULTATION' | 'FARM_VISIT';
  species?: 'CAMEL' | 'CATTLE' | 'SHEEP_GOAT' | 'POULTRY' | 'OTHER' | null;
  animalCount?: number | null;
  villageOrFarm?: string | null;
  status: 'BOOKED' | 'DONE' | 'CANCELLED' | 'NO_SHOW';
  diagnosis?: string | null;
  treatmentNotes?: string | null;
  prescriptionText?: string | null;
  patientAge?: number | string | null;
  patientGender?: string | null;
  symptoms?: string | null;
  followUpDate?: string | null;
  reminderSent: boolean;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  assignedStaff?: { id: string; fullName: string; username: string } | null;
  customer?: { id: string; name: string; phone: string; villageOrFarm?: string | null } | null;
  branch?: { id: string; code: string; name: string; type: string; location: string };
  createdAt: string;
  updatedAt: string;
}

export interface ServerTask {
  id: string;
  branchId: string;
  title: string;
  description?: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'OPEN';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate?: string | null;
  completedAt?: string | null;
  assignedToId?: string | null;
  assignedToName?: string | null;
  assignedTo?: { id: string; fullName: string; username: string } | null;
  createdById: string;
  createdBy?: { id: string; fullName: string } | null;
  branch?: { id: string; code: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface StaffMember {
  id: string;
  fullName: string;
  username: string;
  branchId?: string | null;
}

export const appointmentsApi = {
  async getAppointments(params?: {
    date?: string;
    status?: string;
    visitType?: string;
    assignedStaffId?: string;
  }): Promise<ServerAppointment[]> {
    const query = new URLSearchParams();
    if (params?.date) query.set('date', params.date);
    if (params?.status) query.set('status', params.status);
    if (params?.visitType) query.set('visitType', params.visitType);
    if (params?.assignedStaffId) query.set('assignedStaffId', params.assignedStaffId);
    const qs = query.toString() ? `?${query.toString()}` : '';

    const res = await apiClient.get<{ appointments: ServerAppointment[] }>(`/appointments${qs}`);
    return res.appointments;
  },

  async createAppointment(data: Partial<ServerAppointment>): Promise<ServerAppointment> {
    const res = await apiClient.post<{ appointment: ServerAppointment }>('/appointments', data);
    return res.appointment;
  },

  async updateAppointmentStatus(
    id: string,
    data: {
      status: 'BOOKED' | 'DONE' | 'CANCELLED' | 'NO_SHOW';
      diagnosis?: string;
      treatmentNotes?: string;
      prescriptionText?: string;
      followUpDate?: string | null;
      reminderSent?: boolean;
    }
  ): Promise<ServerAppointment> {
    const res = await apiClient.patch<{ appointment: ServerAppointment }>(
      `/appointments/${id}/status`,
      data
    );
    return res.appointment;
  },

  async getTasks(params?: {
    status?: string;
    assignedToId?: string;
  }): Promise<{ tasks: ServerTask[]; staff: StaffMember[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.assignedToId) query.set('assignedToId', params.assignedToId);
    const qs = query.toString() ? `?${query.toString()}` : '';

    return apiClient.get<{ tasks: ServerTask[]; staff: StaffMember[] }>(
      `/appointments/tasks${qs}`
    );
  },

  async createTask(data: {
    id?: string;
    branchId: string;
    title: string;
    description?: string;
    assignedToId?: string;
    status?: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    dueDate?: string;
    relatedEntityId?: string;
  }): Promise<ServerTask> {
    const res = await apiClient.post<{ task: ServerTask }>('/appointments/tasks', data);
    return res.task;
  },

  async updateTaskStatus(
    id: string,
    data: {
      status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
      assignedToId?: string;
    }
  ): Promise<ServerTask> {
    const res = await apiClient.patch<{ task: ServerTask }>(
      `/appointments/tasks/${id}/status`,
      data
    );
    return res.task;
  },
};

/**
 * Generates bilingual SMS and WhatsApp deep-links for appointment & follow-up reminders
 */
export function buildAppointmentReminderLinks(
  appt: { scheduledAt: string; phone: string; patientOrOwner: string; villageOrFarm?: string | null },
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
