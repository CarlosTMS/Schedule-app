import { getEligibleFaculty, autoAssignFaculty, enrichFaculty } from './facultyMatcher';
import type { Faculty } from './facultyMatcher';
import { getEligibleSMEs, autoAssignSMEs, sessions } from './smeMatcher';
import type { SME, SessionId } from './smeMatcher';
import type { StudentRecord } from './excelParser';
import type { FacultyAssignments } from '../components/FacultySchedule';
import type { SmeAssignments } from '../components/SMESchedule';
import type { SMECacheStatus } from './smeDataLoader';
import { FACULTY_LED_SME_LABEL, activePlanningSessions, isFacultyOnlySession } from './sessionCatalog';
import { getEffectiveSessionUtcHour, getKnownUtcOffset, parseSessionDate } from './timezones';
import { getAssociateEmail } from './associateEmailDirectory';

interface SessionWarning {
  type: 'noSME' | 'noFaculty' | 'smeOutOfHours' | 'facultyOutOfHours' | 'facultyConflict' | 'smeConflict';
  label: string;
}

interface SessionRow {
  sa: string;
  schedule: string;
  sessionDef: (typeof sessions)[number];
  utcHour: number;
  attendees: StudentRecord[];
  assignedSME: SME | null;
  assignedFaculty: Faculty | null;
  warnings: SessionWarning[];
}

export interface SummaryExportSession {
  solution_area: string;
  schedule: string;
  session_id: SessionId;
  facilitator_type: 'faculty_only' | 'sme_and_faculty';
  session_topic: string;
  utc_hour: number;
  attendees_count: number;
  attendees: {
    name: string;
    email?: string;
    country: string;
    office: string;
    specialization: string;
    program?: string;
    utc_offset: number | undefined;
    vat?: string;
  }[];
  sme: { name: string; lob: string; office_location: string; office: string; email: string } | null;
  faculty: { name: string; office: string; email?: string } | null;
  warnings: { code: SessionWarning['type']; label: string }[];
  warning_codes: SessionWarning['type'][];
}

export interface SummaryExport {
  generated_at: string;
  source: {
    sme_last_updated_at: string | null;
    sme_source: string;
  };
  config: {
    startHour: number;
    endHour: number;
    sessionTimeOverrides: Record<string, number>;
    sessionInstanceTimeOverrides: Record<string, number>;
  };
  sessions: SummaryExportSession[];
}

export interface VatsExport {
  generated_at: string;
  total_records: number;
  source_records_count: number;
  excluded_records_count: number;
  total_vats: number;
  vats: {
    vat: string;
    members_count: number;
    solution_areas: string[];
    schedules: string[];
    members: {
      name: string;
      email: string;
      country: string;
      office: string;
      solution_area: string;
      specialization: string;
      schedule: string;
      utc_offset: number | undefined;
    }[];
  }[];
}

const WARNING_LABELS: Record<SessionWarning['type'], string> = {
  noSME: 'No SME available',
  noFaculty: 'No Faculty available',
  smeOutOfHours: 'SME out of working hours',
  facultyOutOfHours: 'Faculty out of working hours',
  facultyConflict: 'Faculty conflict',
  smeConflict: 'SME conflict',
};

const isOutOfHours = (utcHour: number, offsetHours: number, startHour: number, endHour: number): boolean => {
  const localHour = (utcHour + offsetHours + 24) % 24;
  return localHour < startHour || localHour >= endHour;
};

export const getAssignedSA = (record: StudentRecord): string => {
  const legacy = (record as StudentRecord & { 'Solution Week SA'?: string })['Solution Week SA'];
  return record['Solution Weeks SA'] || legacy || '';
};

export const buildSchedulesBySA = (records: StudentRecord[]): Record<string, Set<string>> =>
  records.reduce((acc, record) => {
    const sa = getAssignedSA(record);
    const schedule = record.Schedule;
    if (sa && schedule && schedule !== 'Outlier-Schedule' && schedule !== 'Unassigned') {
      if (!acc[sa]) acc[sa] = new Set();
      acc[sa].add(schedule);
    }
    return acc;
  }, {} as Record<string, Set<string>>);

const buildSummaryRows = ({
  records,
  schedulesBySA,
  startHour,
  endHour,
  facultyStartHour,
  sessionTimeOverrides,
  sessionInstanceTimeOverrides,
  manualSmeAssignments,
  manualFacultyAssignments,
  smeList,
}: {
  records: StudentRecord[];
  schedulesBySA: Record<string, Set<string>>;
  startHour: number;
  endHour: number;
  facultyStartHour: number;
  sessionTimeOverrides: Record<string, number>;
  sessionInstanceTimeOverrides: Record<string, number>;
  manualSmeAssignments: SmeAssignments;
  manualFacultyAssignments: FacultyAssignments;
  smeList: SME[];
}): SessionRow[] => {
  const rows: SessionRow[] = [];
  const allSAs = Object.keys(schedulesBySA).sort();

  for (const sa of allSAs) {
    const schedules = Array.from(schedulesBySA[sa] || []).sort();
    const autoSme = autoAssignSMEs(sa, schedules, startHour, endHour, smeList);
    const autoFac = autoAssignFaculty(sa, schedules, facultyStartHour, endHour);
    const smeAssignmentsForSA = manualSmeAssignments[sa] || autoSme;
    const facAssignmentsForSA = manualFacultyAssignments[sa] || autoFac;

    for (const schedule of schedules) {
      for (const session of activePlanningSessions) {
        const utcHour = getEffectiveSessionUtcHour(sa, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
        const attendees = records.filter(
          (record) => getAssignedSA(record) === sa && record.Schedule === schedule && record.Schedule !== 'Outlier-Schedule'
        );
        const assignedSME = smeAssignmentsForSA[schedule]?.[session.id] ?? null;
        const assignedFaculty = enrichFaculty(facAssignmentsForSA[schedule]?.[session.id] ?? null);
        const eligibleSMEs = getEligibleSMEs(sa, session.id, smeList);
        const eligibleFaculty = getEligibleFaculty(sa);
        const sessionNeedsSME = !isFacultyOnlySession(session.id);
        const warnings: SessionWarning[] = [];

        if (sessionNeedsSME && eligibleSMEs.length === 0) {
          warnings.push({ type: 'noSME', label: WARNING_LABELS.noSME });
        }
        if (eligibleFaculty.length === 0) {
          warnings.push({ type: 'noFaculty', label: WARNING_LABELS.noFaculty });
        }
        if (assignedSME && isOutOfHours(utcHour, getKnownUtcOffset(assignedSME.office_location, session.date), startHour, endHour)) {
          warnings.push({ type: 'smeOutOfHours', label: WARNING_LABELS.smeOutOfHours });
        }
        if (assignedFaculty && isOutOfHours(utcHour, getKnownUtcOffset(assignedFaculty.office, session.date), facultyStartHour, endHour)) {
          warnings.push({ type: 'facultyOutOfHours', label: WARNING_LABELS.facultyOutOfHours });
        }

        if (assignedSME) {
          const targetStartTime = parseSessionDate(session.date).getTime() + utcHour * 60 * 60 * 1000;
          let hasConflict = false;

          for (const otherSA of allSAs) {
            const otherSchedules = Array.from(schedulesBySA[otherSA] || []).sort();
            const otherAutoSme = autoAssignSMEs(otherSA, otherSchedules, startHour, endHour, smeList);
            const otherSmeAssignments = manualSmeAssignments[otherSA] || otherAutoSme;

            for (const otherSchedule of otherSchedules) {
              for (const otherSession of sessions) {
                if (otherSA === sa && otherSchedule === schedule && otherSession.id === session.id) continue;
                const otherAssigned = otherSmeAssignments[otherSchedule]?.[otherSession.id];
                if (otherAssigned?.name !== assignedSME.name) continue;

                const otherUtcHour = getEffectiveSessionUtcHour(
                  otherSA,
                  otherSchedule,
                  otherSession.id,
                  sessionInstanceTimeOverrides,
                  sessionTimeOverrides
                );
                const otherStartTime = parseSessionDate(otherSession.date).getTime() + otherUtcHour * 60 * 60 * 1000;
                const diffMinutes = Math.abs(targetStartTime - otherStartTime) / (1000 * 60);
                if (diffMinutes < 150) {
                  hasConflict = true;
                  break;
                }
              }
              if (hasConflict) break;
            }
            if (hasConflict) break;
          }

          if (hasConflict) {
            warnings.push({ type: 'smeConflict', label: WARNING_LABELS.smeConflict });
          }
        }

        if (assignedFaculty) {
          const targetStartTime = parseSessionDate(session.date).getTime() + utcHour * 60 * 60 * 1000;
          let hasConflict = false;

          for (const otherSA of allSAs) {
            const otherSchedules = Array.from(schedulesBySA[otherSA] || []).sort();
            const otherAutoFaculty = autoAssignFaculty(otherSA, otherSchedules, facultyStartHour, endHour);
            const otherAssignments = manualFacultyAssignments[otherSA] || otherAutoFaculty;

            for (const otherSchedule of otherSchedules) {
              for (const otherSession of sessions) {
                if (otherSA === sa && otherSchedule === schedule && otherSession.id === session.id) continue;
                const otherAssigned = otherAssignments[otherSchedule]?.[otherSession.id];
                if (otherAssigned?.name !== assignedFaculty.name) continue;

                const otherUtcHour = getEffectiveSessionUtcHour(
                  otherSA,
                  otherSchedule,
                  otherSession.id,
                  sessionInstanceTimeOverrides,
                  sessionTimeOverrides
                );
                const otherStartTime = parseSessionDate(otherSession.date).getTime() + otherUtcHour * 60 * 60 * 1000;
                const diffMinutes = Math.abs(targetStartTime - otherStartTime) / (1000 * 60);
                if (diffMinutes < 150) {
                  hasConflict = true;
                  break;
                }
              }
              if (hasConflict) break;
            }
            if (hasConflict) break;
          }

          if (hasConflict) {
            warnings.push({ type: 'facultyConflict', label: WARNING_LABELS.facultyConflict });
          }
        }

        rows.push({
          sa,
          schedule,
          sessionDef: session,
          utcHour,
          attendees,
          assignedSME,
          assignedFaculty,
          warnings,
        });
      }
    }
  }

  return rows;
};

export const buildSummaryExport = ({
  records,
  schedulesBySA = buildSchedulesBySA(records),
  startHour,
  endHour,
  facultyStartHour,
  sessionTimeOverrides,
  sessionInstanceTimeOverrides,
  manualSmeAssignments,
  manualFacultyAssignments,
  smeList,
  smeStatus,
}: {
  records: StudentRecord[];
  schedulesBySA?: Record<string, Set<string>>;
  startHour: number;
  endHour: number;
  facultyStartHour?: number;
  sessionTimeOverrides: Record<string, number>;
  sessionInstanceTimeOverrides: Record<string, number>;
  manualSmeAssignments: SmeAssignments;
  manualFacultyAssignments: FacultyAssignments;
  smeList: SME[];
  smeStatus: SMECacheStatus | null;
}): SummaryExport => {
  const rows = buildSummaryRows({
    records,
    schedulesBySA,
    startHour,
    endHour,
    facultyStartHour: facultyStartHour ?? startHour,
    sessionTimeOverrides,
    sessionInstanceTimeOverrides,
    manualSmeAssignments,
    manualFacultyAssignments,
    smeList,
  });

  return {
    generated_at: new Date().toISOString(),
    source: {
      sme_last_updated_at: smeStatus?.lastUpdatedAt ?? null,
      sme_source: smeStatus?.source ?? 'unknown',
    },
    config: {
      startHour,
      endHour,
      sessionTimeOverrides,
      sessionInstanceTimeOverrides,
    },
    sessions: rows.map((row) => ({
      solution_area: row.sa,
      schedule: row.schedule,
      session_id: row.sessionDef.id,
      facilitator_type: row.sessionDef.facilitatorType,
      session_topic: row.sessionDef.title,
      utc_hour: row.utcHour,
      attendees_count: row.attendees.length,
      attendees: row.attendees.map((attendee) => ({
        name: attendee['Full Name'] ?? '',
        email: getAssociateEmail(attendee['Full Name'], attendee.Email),
        country: attendee.Country ?? '',
        office: attendee.Office ?? '',
        specialization: attendee['(AA) Secondary Specialization'] ?? '',
        program: attendee.Program ?? '',
        utc_offset: attendee._utcOffset,
        vat: attendee.VAT,
      })),
      sme: row.assignedSME
        ? {
            name: row.assignedSME.name,
            lob: row.assignedSME.lob,
            office_location: row.assignedSME.office_location,
            office: row.assignedSME.office_location,
            email: row.assignedSME.email ?? '',
          }
        : row.sessionDef.facilitatorType === 'faculty_only'
          ? {
              name: FACULTY_LED_SME_LABEL,
              lob: '',
              office_location: '',
              office: '',
              email: '',
            }
          : null,
      faculty: row.assignedFaculty
        ? { name: row.assignedFaculty.name, office: row.assignedFaculty.office, email: row.assignedFaculty.email }
        : null,
      warnings: row.warnings.map((warning) => ({ code: warning.type, label: warning.label })),
      warning_codes: row.warnings.map((warning) => warning.type),
    })),
  };
};

export const buildVatsExport = (records: StudentRecord[]): VatsExport => {
  const grouped = new Map<string, StudentRecord[]>();
  for (const record of records) {
    const vat = (record.VAT || '').trim();
    if (!vat || vat === 'Unassigned' || vat === 'Outlier-Size' || !record.Schedule || record.Schedule === 'Outlier-Schedule') {
      continue;
    }
    const list = grouped.get(vat) || [];
    list.push(record);
    grouped.set(vat, list);
  }

  const vats = Array.from(grouped.entries())
    .map(([vat, members]) => ({
      vat,
      members_count: members.length,
      solution_areas: Array.from(new Set(members.map((member) => getAssignedSA(member)).filter(Boolean))).sort() as string[],
      schedules: Array.from(new Set(members.map((member) => member.Schedule).filter(Boolean))).sort() as string[],
      members: members.map((member) => ({
        name: member['Full Name'] ?? '',
        email: getAssociateEmail(member['Full Name'], member.Email),
        country: member.Country ?? '',
        office: member.Office ?? '',
        solution_area: getAssignedSA(member),
        specialization: member['(AA) Secondary Specialization'] ?? '',
        schedule: member.Schedule ?? '',
        utc_offset: member._utcOffset,
      })),
    }))
    .sort((a, b) => a.vat.localeCompare(b.vat));

  const exportedRecordsCount = vats.reduce((sum, vat) => sum + vat.members_count, 0);

  return {
    generated_at: new Date().toISOString(),
    total_records: exportedRecordsCount,
    source_records_count: records.length,
    excluded_records_count: records.length - exportedRecordsCount,
    total_vats: vats.length,
    vats,
  };
};
