import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  List,
  CheckSquare,
  Plus,
  MessageSquare,
  Phone,
  MapPin,
  Stethoscope,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  BAXNAANO_BRANCHES,
  SPECIES_ENUM,
  APPOINTMENT_STATUSES,
  VISIT_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  AppointmentStatusType,
  VisitTypeEnum,
  SpeciesType,
  TaskPriorityType,
  TaskStatusType,
} from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import {
  getOfflineAppointments,
  saveOfflineAppointment,
  updateOfflineAppointmentStatus,
  getOfflineTasks,
  createOfflineTask,
  updateOfflineTaskStatus,
  buildAppointmentReminderLinks,
  OfflineAppointmentRecord,
  OfflineTaskRecord,
} from '../services/appointments.offline';
import { NumericInput } from '../components/NumericInput';

type ActiveView = 'list' | 'calendar' | 'tasks';

export const AppointmentsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, activeBranchId } = useAuth();

  const [view, setView] = useState<ActiveView>('list');
  const [appointments, setAppointments] = useState<OfflineAppointmentRecord[]>([]);
  const [tasks, setTasks] = useState<OfflineTaskRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [showApptModal, setShowApptModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);

  const currentBranchMeta = useMemo(() => {
    const found = Object.values(BAXNAANO_BRANCHES).find(
      (b) => b.id === activeBranchId || b.code === activeBranchId
    );
    return found || BAXNAANO_BRANCHES.B1;
  }, [activeBranchId]);

  const isPharmacyBranch =
    activeBranchId === 'ALL' || currentBranchMeta.type === 'PHARMACY';
  const isVetBranch =
    activeBranchId === 'ALL' || currentBranchMeta.type === 'VETERINARY';

  const loadData = async () => {
    const [appts, tsks] = await Promise.all([
      getOfflineAppointments(activeBranchId),
      getOfflineTasks(activeBranchId),
    ]);
    setAppointments(appts);
    setTasks(tsks);
  };

  useEffect(() => {
    loadData();
  }, [activeBranchId]);

  // Appointment Form State
  const [apptForm, setApptForm] = useState({
    patientOrOwner: '',
    phone: '',
    visitType: (isVetBranch && !isPharmacyBranch ? 'FARM_VISIT' : 'CONSULTATION') as VisitTypeEnum,
    scheduledAt: new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16),
    // Pharmacy B1
    patientAge: '',
    patientGender: 'Female',
    symptoms: '',
    prescriptionText: '',
    // Vet B2/B3
    species: 'CAMEL' as SpeciesType,
    animalCount: 10,
    villageOrFarm: '',
    treatmentNotes: '',
    // Shared
    diagnosis: '',
    followUpDate: '',
  });

  // Task Form State
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    assignedToName: user?.fullName || '',
    priority: 'MEDIUM' as TaskPriorityType,
    dueDate: new Date().toISOString().slice(0, 10),
  });

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (view === 'calendar' && !a.scheduledAt.startsWith(selectedCalendarDate)) {
        return false;
      }
      return true;
    });
  }, [appointments, statusFilter, view, selectedCalendarDate]);

  // 7-day Calendar Strip around selectedCalendarDate
  const calendarDays = useMemo(() => {
    const base = new Date(selectedCalendarDate);
    const days: Array<{ dateStr: string; label: string; count: number }> = [];
    for (let offset = -2; offset <= 4; offset++) {
      const d = new Date(base);
      d.setDate(base.getDate() + offset);
      const iso = d.toISOString().slice(0, 10);
      const count = appointments.filter((a) => a.scheduledAt.startsWith(iso)).length;
      days.push({
        dateStr: iso,
        label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        count,
      });
    }
    return days;
  }, [selectedCalendarDate, appointments]);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const targetBranch =
      activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId;

    await saveOfflineAppointment({
      branchId: targetBranch,
      assignedStaffId: user.id,
      assignedStaffName: user.fullName,
      patientOrOwner: apptForm.patientOrOwner,
      phone: apptForm.phone,
      status: 'BOOKED',
      visitType: apptForm.visitType,
      scheduledAt: new Date(apptForm.scheduledAt).toISOString(),
      patientAge: apptForm.patientAge ? Number(apptForm.patientAge) : null,
      patientGender: isPharmacyBranch ? apptForm.patientGender : null,
      symptoms: isPharmacyBranch ? apptForm.symptoms || null : null,
      prescriptionText: isPharmacyBranch ? apptForm.prescriptionText || null : null,
      species: isVetBranch ? apptForm.species : null,
      animalCount: isVetBranch ? Number(apptForm.animalCount) : null,
      villageOrFarm: isVetBranch ? apptForm.villageOrFarm || null : null,
      treatmentNotes: isVetBranch ? apptForm.treatmentNotes || null : null,
      diagnosis: apptForm.diagnosis || null,
      followUpDate: apptForm.followUpDate || null,
      reminderSent: false,
    });

    setShowApptModal(false);
    setApptForm((prev) => ({
      ...prev,
      patientOrOwner: '',
      phone: '',
      patientAge: '',
      symptoms: '',
      prescriptionText: '',
      villageOrFarm: '',
      treatmentNotes: '',
      diagnosis: '',
      followUpDate: '',
    }));
    await loadData();
  };

  const handleStatusChange = async (apptId: string, nextStatus: AppointmentStatusType) => {
    await updateOfflineAppointmentStatus({ appointmentId: apptId, status: nextStatus });
    await loadData();
  };

  const handleSendReminder = async (
    appt: OfflineAppointmentRecord,
    channel: 'whatsapp' | 'sms'
  ) => {
    const links = buildAppointmentReminderLinks(
      appt,
      currentBranchMeta.name,
      (i18n.language as 'en' | 'so') || 'en'
    );
    window.open(channel === 'whatsapp' ? links.whatsappUrl : links.smsUrl, '_blank');
    await updateOfflineAppointmentStatus({
      appointmentId: appt.id,
      status: appt.status,
      reminderSent: true,
    });
    await loadData();
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const targetBranch =
      activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId;

    await createOfflineTask({
      branchId: targetBranch,
      title: taskForm.title,
      description: taskForm.description || null,
      assignedToId: user.id,
      assignedToName: taskForm.assignedToName || user.fullName,
      createdById: user.id,
      status: 'OPEN',
      priority: taskForm.priority,
      dueDate: taskForm.dueDate || null,
    });

    setShowTaskModal(false);
    setTaskForm({
      title: '',
      description: '',
      assignedToName: user.fullName,
      priority: 'MEDIUM',
      dueDate: new Date().toISOString().slice(0, 10),
    });
    await loadData();
  };

  const handleTaskStatusChange = async (taskId: string, status: TaskStatusType) => {
    await updateOfflineTaskStatus(taskId, status);
    await loadData();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Stethoscope className="w-7 h-7 text-emerald-600" />
            {t('appointments.title')}
          </h1>
          <p className="text-xs text-slate-500">
            {currentBranchMeta.code} - {currentBranchMeta.name} ({currentBranchMeta.location})
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowApptModal(true)}
            className="min-h-[48px] px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            {t('appointments.new_appointment')}
          </button>
          <button
            onClick={() => setShowTaskModal(true)}
            className="min-h-[48px] px-5 py-2.5 bg-slate-800 dark:bg-slate-700 text-white font-semibold rounded-xl flex items-center gap-2"
          >
            <CheckSquare className="w-5 h-5" />
            {t('appointments.new_task')}
          </button>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setView('list')}
            className={`min-h-[44px] px-4 py-2 rounded-xl font-medium flex items-center gap-2 ${
              view === 'list'
                ? 'bg-emerald-600 text-white'
                : 'bg-white dark:bg-slate-800 border'
            }`}
          >
            <List className="w-4 h-4" />
            {t('appointments.tabs.list')}
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`min-h-[44px] px-4 py-2 rounded-xl font-medium flex items-center gap-2 ${
              view === 'calendar'
                ? 'bg-emerald-600 text-white'
                : 'bg-white dark:bg-slate-800 border'
            }`}
          >
            <Calendar className="w-4 h-4" />
            {t('appointments.tabs.calendar')}
          </button>
          <button
            onClick={() => setView('tasks')}
            className={`min-h-[44px] px-4 py-2 rounded-xl font-medium flex items-center gap-2 ${
              view === 'tasks'
                ? 'bg-emerald-600 text-white'
                : 'bg-white dark:bg-slate-800 border'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            {t('appointments.tabs.tasks')} (
            {tasks.filter((tk) => tk.status !== 'COMPLETED').length})
          </button>
        </div>

        {view !== 'tasks' && (
          <div className="flex items-center gap-2">
            {(['ALL', ...APPOINTMENT_STATUSES] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  statusFilter === st
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-white dark:bg-slate-800 border'
                }`}
              >
                {st === 'ALL' ? 'ALL' : t(`appointments.status.${st}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* CALENDAR DATE STRIP (When in Calendar View) */}
      {view === 'calendar' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedCalendarDate}
              onChange={(e) => setSelectedCalendarDate(e.target.value)}
              className="min-h-[44px] px-3 py-2 border rounded-xl bg-white dark:bg-slate-800 font-semibold"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
            {calendarDays.map((day) => (
              <button
                key={day.dateStr}
                onClick={() => setSelectedCalendarDate(day.dateStr)}
                className={`p-3 rounded-xl border text-left transition ${
                  day.dateStr === selectedCalendarDate
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold">{day.label}</div>
                <div className="text-lg font-extrabold mt-1">{day.count}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* APPOINTMENTS LIST / CALENDAR CARDS */}
      {view !== 'tasks' && (
        <div className="space-y-3">
          {filteredAppointments.map((appt) => {
            const statusColors: Record<AppointmentStatusType, string> = {
              BOOKED: 'bg-sky-100 text-sky-800',
              DONE: 'bg-emerald-100 text-emerald-800',
              CANCELLED: 'bg-slate-200 text-slate-700 line-through',
              NO_SHOW: 'bg-red-100 text-red-800',
            };

            return (
              <div
                key={appt.id}
                className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                        statusColors[appt.status]
                      }`}
                    >
                      {t(`appointments.status.${appt.status}`)}
                    </span>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">
                      {t(`appointments.visit_type.${appt.visitType}`)}
                    </span>
                    <h3 className="font-bold text-lg">{appt.patientOrOwner}</h3>
                    <span className="text-xs font-mono text-slate-500">{appt.phone}</span>
                    {appt.reminderSent && (
                      <span className="text-[11px] bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">
                        ✓ {t('appointments.shared.reminder_sent_badge')}
                      </span>
                    )}
                  </div>

                  {/* Scheduled Time & Village/Farm Location */}
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-4">
                    <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                      <Clock className="w-3.5 h-3.5 text-emerald-600" />
                      {new Date(appt.scheduledAt).toLocaleString()}
                    </span>

                    {appt.villageOrFarm && (
                      <span className="flex items-center gap-1 text-sky-700 dark:text-sky-400 font-medium">
                        <MapPin className="w-3.5 h-3.5" />
                        {appt.villageOrFarm}
                      </span>
                    )}

                    {appt.species && (
                      <span>
                        {t('appointments.vet.species')}:{' '}
                        <strong>{t(`inventory.species.${appt.species}`)}</strong> (Count:{' '}
                        <strong>{appt.animalCount || 1}</strong>)
                      </span>
                    )}

                    {appt.patientAge && (
                      <span>
                        Age: <strong>{appt.patientAge}</strong> ({appt.patientGender || ''})
                      </span>
                    )}
                  </div>

                  {/* Clinical / Prescription / Treatment Notes */}
                  {(appt.symptoms ||
                    appt.diagnosis ||
                    appt.prescriptionText ||
                    appt.treatmentNotes) && (
                    <div className="text-xs bg-slate-50 dark:bg-slate-900 p-2.5 rounded-xl border border-slate-100 dark:border-slate-700 space-y-1 mt-1">
                      {appt.symptoms && (
                        <div>
                          <strong>Symptoms:</strong> {appt.symptoms}
                        </div>
                      )}
                      {appt.diagnosis && (
                        <div>
                          <strong>Diagnosis:</strong> {appt.diagnosis}
                        </div>
                      )}
                      {appt.prescriptionText && (
                        <div>
                          <strong>Rx:</strong> {appt.prescriptionText}
                        </div>
                      )}
                      {appt.treatmentNotes && (
                        <div>
                          <strong>Vet Treatment:</strong> {appt.treatmentNotes}
                        </div>
                      )}
                      {appt.followUpDate && (
                        <div className="text-amber-600 font-semibold">
                          Follow-up Date: {appt.followUpDate.slice(0, 10)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Status Transitions & SMS / WhatsApp Reminders */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSendReminder(appt, 'whatsapp')}
                    className="min-h-[42px] px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-4 h-4" />
                    {t('appointments.shared.send_whatsapp')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendReminder(appt, 'sms')}
                    className="min-h-[42px] px-3 py-2 border text-xs font-semibold rounded-xl flex items-center gap-1.5"
                  >
                    <Phone className="w-4 h-4" />
                    {t('appointments.shared.send_sms')}
                  </button>

                  <select
                    value={appt.status}
                    onChange={(e) =>
                      handleStatusChange(appt.id, e.target.value as AppointmentStatusType)
                    }
                    className="min-h-[42px] px-3 py-2 rounded-xl border font-bold text-xs bg-slate-50 dark:bg-slate-900"
                  >
                    {APPOINTMENT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {t(`appointments.status.${st}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* STAFF TASKS VIEW */}
      {view === 'tasks' && (
        <div className="space-y-3">
          {tasks.map((tk) => (
            <div
              key={tk.id}
              className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                      tk.priority === 'URGENT'
                        ? 'bg-red-100 text-red-800'
                        : tk.priority === 'HIGH'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {t(`appointments.tasks.priority.${tk.priority}`)}
                  </span>
                  <h3
                    className={`font-bold text-base ${
                      tk.status === 'COMPLETED' ? 'line-through text-slate-400' : ''
                    }`}
                  >
                    {tk.title}
                  </h3>
                </div>
                {tk.description && (
                  <p className="text-xs text-slate-500 mt-1">{tk.description}</p>
                )}
                <div className="text-xs text-slate-400 mt-1 flex gap-4">
                  <span>
                    {t('appointments.tasks.assigned_to')}:{' '}
                    <strong>{tk.assignedToName || 'Staff'}</strong>
                  </span>
                  {tk.dueDate && (
                    <span>
                      {t('appointments.tasks.due_date')}:{' '}
                      <strong>{tk.dueDate.slice(0, 10)}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {tk.status !== 'COMPLETED' && (
                  <button
                    onClick={() => handleTaskStatusChange(tk.id, 'COMPLETED')}
                    className="min-h-[42px] px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Mark Completed
                  </button>
                )}
                <select
                  value={tk.status}
                  onChange={(e) =>
                    handleTaskStatusChange(tk.id, e.target.value as TaskStatusType)
                  }
                  className="min-h-[42px] px-3 py-2 border rounded-xl text-xs font-semibold dark:bg-slate-900"
                >
                  {TASK_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {t(`appointments.tasks.status.${st}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BOOK APPOINTMENT MODAL (Pharmacy B1 Consultation vs Vet B2/B3 Herd/Farm Visit) */}
      {showApptModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCreateAppointment}
            className="bg-white dark:bg-slate-800 p-6 rounded-2xl max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-xl font-bold">{t('appointments.new_appointment')}</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                required
                placeholder={t('appointments.patient_or_owner')}
                value={apptForm.patientOrOwner}
                onChange={(e) =>
                  setApptForm({ ...apptForm, patientOrOwner: e.target.value })
                }
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
              <input
                required
                placeholder={t('appointments.phone')}
                value={apptForm.phone}
                onChange={(e) => setApptForm({ ...apptForm, phone: e.target.value })}
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
              <div>
                <label className="block text-xs font-semibold mb-1">Visit Type</label>
                <select
                  value={apptForm.visitType}
                  onChange={(e) =>
                    setApptForm({ ...apptForm, visitType: e.target.value as VisitTypeEnum })
                  }
                  className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                >
                  {VISIT_TYPES.map((vt) => (
                    <option key={vt} value={vt}>
                      {t(`appointments.visit_type.${vt}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">
                  {t('appointments.scheduled_at')}
                </label>
                <input
                  type="datetime-local"
                  required
                  value={apptForm.scheduledAt}
                  onChange={(e) =>
                    setApptForm({ ...apptForm, scheduledAt: e.target.value })
                  }
                  className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
            </div>

            {/* B1 Pharmacy Patient Consultation Section */}
            {isPharmacyBranch && (
              <div className="p-4 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 space-y-3">
                <h3 className="font-bold text-sm text-purple-900 dark:text-purple-300">
                  {t('appointments.pharmacy.section_title')}
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    placeholder={t('appointments.pharmacy.patient_age')}
                    value={apptForm.patientAge}
                    onChange={(e) =>
                      setApptForm({ ...apptForm, patientAge: e.target.value })
                    }
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                  <select
                    value={apptForm.patientGender}
                    onChange={(e) =>
                      setApptForm({ ...apptForm, patientGender: e.target.value })
                    }
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  >
                    <option value="Female">Female (Dheddig)</option>
                    <option value="Male">Male (Lab)</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  placeholder={t('appointments.pharmacy.symptoms')}
                  value={apptForm.symptoms}
                  onChange={(e) => setApptForm({ ...apptForm, symptoms: e.target.value })}
                  className="w-full p-2.5 border rounded-lg dark:bg-slate-900 text-sm"
                />
                <textarea
                  rows={2}
                  placeholder={t('appointments.pharmacy.prescription')}
                  value={apptForm.prescriptionText}
                  onChange={(e) =>
                    setApptForm({ ...apptForm, prescriptionText: e.target.value })
                  }
                  className="w-full p-2.5 border rounded-lg dark:bg-slate-900 text-sm"
                />
              </div>
            )}

            {/* B2 / B3 Veterinary Livestock Herd & Farm Visit Section */}
            {isVetBranch && (
              <div className="p-4 rounded-xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 space-y-3">
                <h3 className="font-bold text-sm text-sky-900 dark:text-sky-300">
                  {t('appointments.vet.section_title')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select
                    value={apptForm.species}
                    onChange={(e) =>
                      setApptForm({ ...apptForm, species: e.target.value as SpeciesType })
                    }
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  >
                    {SPECIES_ENUM.filter((s) => s !== 'HUMAN').map((sp) => (
                      <option key={sp} value={sp}>
                        {t(`inventory.species.${sp}`)}
                      </option>
                    ))}
                  </select>
                  <NumericInput
                    min={1}
                    placeholder={t('appointments.vet.animal_count')}
                    value={apptForm.animalCount}
                    onChange={(val) =>
                      setApptForm({ ...apptForm, animalCount: val })
                    }
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                  <input
                    placeholder={t('appointments.vet.village_or_farm')}
                    value={apptForm.villageOrFarm}
                    onChange={(e) =>
                      setApptForm({ ...apptForm, villageOrFarm: e.target.value })
                    }
                    className="min-h-[44px] px-3 py-2 border rounded-lg dark:bg-slate-900"
                  />
                </div>
                <textarea
                  rows={2}
                  placeholder={t('appointments.vet.treatment_notes')}
                  value={apptForm.treatmentNotes}
                  onChange={(e) =>
                    setApptForm({ ...apptForm, treatmentNotes: e.target.value })
                  }
                  className="w-full p-2.5 border rounded-lg dark:bg-slate-900 text-sm"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                placeholder={t('appointments.shared.diagnosis')}
                value={apptForm.diagnosis}
                onChange={(e) => setApptForm({ ...apptForm, diagnosis: e.target.value })}
                className="min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
              <div>
                <label className="block text-xs font-semibold mb-1">
                  {t('appointments.shared.follow_up_date')}
                </label>
                <input
                  type="date"
                  value={apptForm.followUpDate}
                  onChange={(e) =>
                    setApptForm({ ...apptForm, followUpDate: e.target.value })
                  }
                  className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowApptModal(false)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 bg-emerald-600 text-white font-semibold rounded-xl"
              >
                Save Appointment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE STAFF TASK MODAL */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTask}
            className="bg-white dark:bg-slate-800 p-6 rounded-2xl max-w-md w-full space-y-4"
          >
            <h2 className="text-lg font-bold">{t('appointments.new_task')}</h2>
            <input
              required
              placeholder={t('appointments.tasks.title')}
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
            />
            <textarea
              rows={2}
              placeholder={t('appointments.tasks.description')}
              value={taskForm.description}
              onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              className="w-full p-3 border rounded-xl dark:bg-slate-900 text-sm"
            />
            <input
              placeholder={t('appointments.tasks.assigned_to')}
              value={taskForm.assignedToName}
              onChange={(e) => setTaskForm({ ...taskForm, assignedToName: e.target.value })}
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={taskForm.priority}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, priority: e.target.value as TaskPriorityType })
                }
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              >
                {TASK_PRIORITIES.map((pr) => (
                  <option key={pr} value={pr}>
                    {t(`appointments.tasks.priority.${pr}`)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={taskForm.dueDate}
                onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTaskModal(false)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 bg-emerald-600 text-white font-semibold rounded-xl"
              >
                Assign Task
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
