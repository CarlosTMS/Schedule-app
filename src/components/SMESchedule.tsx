import { useState, useMemo } from 'react';
import { Users, MapPin, Building2, UserCircle2, AlertCircle, RefreshCw, Minus, Plus, Copy, CheckCircle2, MessageSquareShare } from 'lucide-react';
import { sessions, getEligibleSMEs, autoAssignSMEs } from '../lib/smeMatcher';
import type { SME, SessionId } from '../lib/smeMatcher';
import type { SMECacheStatus } from '../lib/smeDataLoader';
import { autoAssignFaculty, enrichFaculty } from '../lib/facultyMatcher';
import type { FacultyAssignments } from './FacultySchedule';
import { getKnownUtcOffset, getEffectiveSessionUtcHour, getLocalTimeForUtcHour, extractScheduleKey, formatUtcHourLabel, makeSessionInstanceOverrideKey, wrapUtcHour, parseSessionDate } from '../lib/timezones';
import { FACULTY_LED_SME_LABEL, activePlanningSessions } from '../lib/sessionCatalog';
import { useI18n } from '../i18n';

// Shared assignment shape used by Dashboard, SMESchedule, FacultySchedule, and Summary
export type SmeAssignments = Record<string, Record<string, Record<SessionId, SME | null>>>;
export type SmeConfirmationState = Record<string, Record<string, Record<SessionId, boolean>>>;

interface SMEScheduleProps {
    schedulesBySA: Record<string, Set<string>>;
    startHour: number;
    endHour: number;
    facultyStartHour?: number;
    sessionTimeOverrides?: Record<string, number>;
    sessionInstanceTimeOverrides?: Record<string, number>;
    onSessionInstanceTimeOverridesChange?: (next: Record<string, number>) => void;
    smeList: SME[];
    smeStatus?: SMECacheStatus | null;
    onRefreshSMEs?: () => void;
    /** Lifted-state assignments — from Dashboard */
    manualSmeAssignments: SmeAssignments;
    onSmeAssignmentsChange: (next: SmeAssignments) => void;
    smeConfirmationState: SmeConfirmationState;
    onSmeConfirmationStateChange: (next: SmeConfirmationState) => void;
    manualFacultyAssignments: FacultyAssignments;
}

const SA_LEADS: Record<string, { saLead: string; salesLead: string; csmLead: string }> = {
    'Cloud ERP': { saLead: 'Jessica', salesLead: 'Sandra', csmLead: 'Amy' },
    'oCFO': { saLead: 'Jessica', salesLead: 'Sandra', csmLead: 'Amy' },
    'Procurement': { saLead: 'Jessica', salesLead: 'Sandra', csmLead: 'Amy' },
    'BTP': { saLead: 'Fernando', salesLead: 'Pau', csmLead: 'Carlos' },
    'Data & AI': { saLead: 'Fernando', salesLead: 'Pau', csmLead: 'Carlos' },
    'BTM': { saLead: 'David', salesLead: 'Daron', csmLead: 'Nelly / Hanna' },
    'CX': { saLead: 'David', salesLead: 'Daron', csmLead: 'Nelly / Juan' },
    'HCM': { saLead: 'Godfrey', salesLead: 'Reese', csmLead: 'Hanna / Daniel*' },
    'SCM': { saLead: 'Ivan', salesLead: 'Reese', csmLead: 'Selene* & Lilly*' },
};

const LEAD_EMAIL_BY_NAME: Record<string, string> = {
    'laura kleban': 'laura.kleban@sap.com',
    'nicholas goffi': 'nicholas.goffi@sap.com',
    'nick': 'nicholas.goffi@sap.com',
    'kristen piasecki': 'kristen.piasecki@sap.com',
    'david uichanco': 'david.uichanco@sap.com',
    'david': 'david.uichanco@sap.com',
    'jessica zhang': 'jessica.zhang@sap.com',
    'jessica': 'jessica.zhang@sap.com',
    'godfrey leung': 'godfrey.leung@sap.com',
    'godfrey': 'godfrey.leung@sap.com',
    'hanna kielland aalen': 'hanna.kielland.aalen@sap.com',
    'hanna': 'hanna.kielland.aalen@sap.com',
    'julian bender': 'julian.bender@sap.com',
    'juan antonio gonzalez': 'juan.gonzalez02@sap.com',
    'juan': 'juan.gonzalez02@sap.com',
    'amy hawkins': 'amy.hawkins@sap.com',
    'amy': 'amy.hawkins@sap.com',
    'carlos moreno': 'carlos.edgar.moreno@sap.com',
    'carlos': 'carlos.edgar.moreno@sap.com',
    'maggie ramaiah': 'm.ramaiah@sap.com',
    'nelly rebollo': 'nelly.rebollo@sap.com',
    'nelly': 'nelly.rebollo@sap.com',
    'daron smith': 'daron.smith@sap.com',
    'daron': 'daron.smith@sap.com',
    'rissa colayco': 'r.colayco@sap.com',
    'marcel storost': 'm.storost@sap.com',
    'ed kipley': 'ed.kipley@sap.com',
    'hedda samia': 'hedda.samia@sap.com',
    'raul alfonso': 'raul.alfonso@sap.com',
    'andrew clark': 'andrew.clark@sap.com',
    'beatriz garrido': 'beatriz.garrido@sap.com',
    'bradley cox': 'bradley.cox@sap.com',
    'carolin schoder-thuemling': 'carolin.schoder-thuemling@sap.com',
    'hans loekkegaard': 'hans.loekkegaard@sap.com',
    'jean ooi': 'jean.ooi@sap.com',
    'katie mckenna': 'katie.mckenna@sap.com',
    'sulamita hellen milan': 's.milan@sap.com',
    'tina alsted grejsen': 't.grejsen@sap.com',
    'verena muehlbauer': 'verena.muehlbauer@sap.com',
    'victoria rodrigues ratautas': 'victoria.rodrigues.ratautas@sap.com',
    'selene hernandez': 'selene.hernandez@sap.com',
    'selene': 'selene.hernandez@sap.com',
    'sofia marina lise': 'sofia.lise@sap.com',
    'pau pujol-xicoy': 'pau.pujol-xicoy@sap.com',
    'pau': 'pau.pujol-xicoy@sap.com',
    'sandra bissels': 'sandra.bissels@sap.com',
    'sandra': 'sandra.bissels@sap.com',
    'daniel arroyave': 'daniel.arroyave@sap.com',
    'daniel': 'daniel.arroyave@sap.com',
    'reese': 'r.colayco@sap.com',
    'ivan': 'ivan.aguilar@sap.com',
    'lilly': 'lilly.schmidt01@sap.com',
    'fernando sanchez': 'fernando.sanchez@sap.com',
    'fernando': 'fernando.sanchez@sap.com',
};

const ALWAYS_INCLUDED_LEAD_EMAILS = [
    'carlos.edgar.moreno@sap.com',
    'sandra.bissels@sap.com',
];

const normalizeLeadToken = (value: string): string =>
    value
        .replace(/\*/g, '')
        .trim()
        .toLowerCase();

const expandLeadNames = (value: string): string[] =>
    value
        .split(/\/|&/)
        .map(token => token.trim())
        .filter(Boolean);

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const FOLLOW_UP_NOTE_1 =
    'If you are added to some of the sessions (like Adoption and Risk) is because we are still looking for an SME.';
const FOLLOW_UP_NOTE_2 =
    'Carlos is currently working on getting an SME for Adoption and Risk. We will update you on that.';

export function SMESchedule({
    schedulesBySA,
    startHour,
    endHour,
    facultyStartHour,
    sessionTimeOverrides = {},
    sessionInstanceTimeOverrides = {},
    onSessionInstanceTimeOverridesChange,
    smeList,
    smeStatus,
    onRefreshSMEs,
    manualSmeAssignments,
    onSmeAssignmentsChange,
    smeConfirmationState,
    onSmeConfirmationStateChange,
    manualFacultyAssignments,
}: SMEScheduleProps) {
    const { t } = useI18n();
    const uniqueSAs = Object.keys(schedulesBySA).sort();

    const [selectedSAState, setSelectedSA] = useState<string>('');
    const [copiedSummary, setCopiedSummary] = useState(false);
    const selectedSA = uniqueSAs.includes(selectedSAState) ? selectedSAState : (uniqueSAs.length > 0 ? uniqueSAs[0] : '');

    // Helper to get all assignments (manual + auto fallback) across all SAs for conflict detection
    const allAssignments = useMemo(() => {
        const all: SmeAssignments = {};
        const sAs = Object.keys(schedulesBySA).sort();
        for (const sa of sAs) {
            const avail = Array.from(schedulesBySA[sa] || []).sort((a, b) => a.localeCompare(b));
            all[sa] = manualSmeAssignments[sa] || autoAssignSMEs(sa, avail, startHour, endHour, smeList);
        }
        return all;
    }, [schedulesBySA, manualSmeAssignments, startHour, endHour, smeList]);

    if (!selectedSA) {
        return null;
    }

    const availableSchedules = Array.from(schedulesBySA[selectedSA] || []).sort((a, b) => a.localeCompare(b));
    const selectedLeads = SA_LEADS[selectedSA];
    const effectiveFacultyStartHour = facultyStartHour ?? startHour;
    const visibleSessions = activePlanningSessions.filter(session => session.facilitatorType !== 'faculty_only');
    const leadEntries = selectedLeads
        ? [
            { label: 'saLead', name: selectedLeads.saLead },
            { label: 'salesLead', name: selectedLeads.salesLead },
            { label: 'csmLead', name: selectedLeads.csmLead },
        ].flatMap(entry =>
            expandLeadNames(entry.name).map(name => ({
                role: entry.label,
                name,
                email: LEAD_EMAIL_BY_NAME[normalizeLeadToken(name)],
            }))
        )
        : [];
    const leadEmails = Array.from(new Set([
        ...leadEntries.map(entry => entry.email).filter((value): value is string => Boolean(value)),
        ...ALWAYS_INCLUDED_LEAD_EMAILS,
    ]));
    const missingLeadEmails = Array.from(new Set(leadEntries.filter(entry => !entry.email).map(entry => entry.name)));

    // Use lifted manual assignments if they exist for this SA; otherwise fallback to auto-assignments.
    const currentAssignments = manualSmeAssignments[selectedSA] || autoAssignSMEs(selectedSA, availableSchedules, startHour, endHour, smeList);
    const currentFacultyAssignments =
        manualFacultyAssignments[selectedSA] || autoAssignFaculty(selectedSA, availableSchedules, effectiveFacultyStartHour, endHour);
    const currentConfirmations = smeConfirmationState[selectedSA] || {};

    const getConflict = (smeName: string, targetSchedule: string, targetSessionId: SessionId, targetSA: string): string | null => {
        const targetSession = sessions.find(s => s.id === targetSessionId);
        if (!targetSession) return null;
        
        const targetUtcHour = getEffectiveSessionUtcHour(targetSA, targetSchedule, targetSessionId, sessionInstanceTimeOverrides, sessionTimeOverrides);
        const targetStartTime = parseSessionDate(targetSession.date).getTime() + targetUtcHour * 60 * 60 * 1000;
        
        for (const sa of Object.keys(allAssignments)) {
            const saAssignments = allAssignments[sa];
            for (const schedule of Object.keys(saAssignments)) {
                const sessionAssignments = saAssignments[schedule];
                for (const sessionId of Object.keys(sessionAssignments)) {
                    // Skip if it's the exact same session instance
                    if (sa === targetSA && schedule === targetSchedule && sessionId === targetSessionId) continue;
                    
                    const assigned = sessionAssignments[sessionId as SessionId];
                    if (assigned && assigned.name === smeName) {
                        const session = sessions.find(s => s.id === sessionId);
                        if (!session) continue;
                        
                        const utcHour = getEffectiveSessionUtcHour(sa, schedule, sessionId as SessionId, sessionInstanceTimeOverrides, sessionTimeOverrides);
                        const startTime = parseSessionDate(session.date).getTime() + utcHour * 60 * 60 * 1000;
                        
                        const diffMinutes = Math.abs(targetStartTime - startTime) / (1000 * 60);
                        
                        if (diffMinutes < 150) {
                            const topicObj = sessions.find(s => s.id === sessionId);
                            const topicName = topicObj ? topicObj.title : sessionId;
                            const scheduleLabel = extractScheduleKey(schedule).replace(`${sa} `, '');
                            const locationInfo = sa === targetSA ? `${scheduleLabel} - ${topicName}` : `${sa} - ${topicName}`;
                            return locationInfo; 
                        }
                    }
                }
            }
        }
        return null;
    };

    const handleSMEChange = (schedule: string, sessionId: SessionId, smeName: string) => {
        const eligible = getEligibleSMEs(selectedSA, sessionId, smeList);
        const newSME = eligible.find(s => s.name === smeName) || null;

        const currentAuto = autoAssignSMEs(selectedSA, availableSchedules, startHour, endHour, smeList);
        const saData = manualSmeAssignments[selectedSA] || currentAuto;

        onSmeAssignmentsChange({
            ...manualSmeAssignments,
            [selectedSA]: {
                ...saData,
                [schedule]: {
                    ...saData[schedule],
                    [sessionId]: newSME,
                },
            },
        });
    };

    // Need to import useMemo from react if not already

    const handleSessionTimeAdjustment = (schedule: string, sessionId: SessionId, delta: number) => {
        if (!onSessionInstanceTimeOverridesChange) return;
        const key = makeSessionInstanceOverrideKey(selectedSA, schedule, sessionId);
        const currentHour = getEffectiveSessionUtcHour(selectedSA, schedule, sessionId, sessionInstanceTimeOverrides, sessionTimeOverrides);
        onSessionInstanceTimeOverridesChange({
            ...sessionInstanceTimeOverrides,
            [key]: wrapUtcHour(currentHour + delta),
        });
    };

    const handleConfirmationToggle = (schedule: string, sessionId: SessionId) => {
        const saData = smeConfirmationState[selectedSA] || {};
        const scheduleData = saData[schedule] || {} as Record<SessionId, boolean>;
        const currentValue = scheduleData[sessionId] ?? false;

        onSmeConfirmationStateChange({
            ...smeConfirmationState,
            [selectedSA]: {
                ...saData,
                [schedule]: {
                    ...scheduleData,
                    [sessionId]: !currentValue,
                },
            },
        });
    };

    const buildCurrentLobSummaryText = () => {
        const lines: string[] = [
            `Hello Beautiful ${selectedSA} Team! Hope you are doing great!`,
            '',
            'We wanted to do a quick check on your progress validating availability of your SMEs for the upcoming sessions.',
            '',
            'So far we have this list. Can you confirm if the different speakers for each session are correct based on our data? If changes happened, we want to update our information before we start sending blockers.',
            '',
            `${t('solutionArea')}: ${selectedSA}`,
            '',
        ];

        if (selectedLeads) {
            lines.push(`${t('smeLeadsTitle')}`);
            lines.push(`- ${t('smeLeadSa')}: ${selectedLeads.saLead}`);
            lines.push(`- ${t('smeLeadSales')}: ${selectedLeads.salesLead}`);
            lines.push(`- ${t('smeLeadCsm')}: ${selectedLeads.csmLead}`);
            lines.push('');
        }

        activePlanningSessions.forEach((session) => {
            lines.push(`${session.title}`);
            lines.push(`${session.onlineSessionDay} | ${session.date}`);

            availableSchedules.forEach((schedule) => {
                const assignedSME = currentAssignments[schedule]?.[session.id] ?? null;
                const assignedFaculty = enrichFaculty(currentFacultyAssignments[schedule]?.[session.id] ?? null);
                const utcHour = getEffectiveSessionUtcHour(selectedSA, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
                const scheduleLabel = extractScheduleKey(schedule).replace(`${selectedSA} `, '');
                const localLabel = assignedSME
                    ? getLocalTimeForUtcHour(utcHour, assignedSME.office_location, session.date)
                    : (assignedFaculty ? getLocalTimeForUtcHour(utcHour, assignedFaculty.office, session.date) : '-');

                lines.push(`- ${scheduleLabel}`);
                lines.push(`  Time: ${formatUtcHourLabel(utcHour)} | ${localLabel}`);
                lines.push(`  SME: ${session.facilitatorType === 'faculty_only' ? FACULTY_LED_SME_LABEL : (assignedSME?.name ?? t('smeSummaryUnassigned'))}`);
                lines.push(`  ${t('locationLabel')}: ${assignedSME?.office_location ?? assignedFaculty?.office ?? '-'}`);
                lines.push(`  Faculty: ${assignedFaculty?.name ?? '-'}`);
            });

            lines.push('');
        });

        lines.push(FOLLOW_UP_NOTE_1);
        lines.push('');
        lines.push(FOLLOW_UP_NOTE_2);

        return lines.join('\n').trim();
    };

    const buildCurrentLobSummaryHtml = () => {
        const parts: string[] = [
            `<div><strong>Hello Beautiful ${escapeHtml(selectedSA)} Team!</strong> Hope you are doing great!</div>`,
            '<div style="margin-top:12px;">We wanted to do a quick check on your progress validating availability of your SMEs for the upcoming sessions.</div>',
            '<div style="margin-top:12px;">So far we have this list. Can you confirm if the different speakers for each session are correct based on our data? If changes happened, we want to update our information before we start sending blockers.</div>',
            `<div style="margin-top:14px;"><strong>${escapeHtml(t('solutionArea'))}:</strong> ${escapeHtml(selectedSA)}</div>`,
        ];

        if (selectedLeads) {
            parts.push('<div style="margin-top:12px;">');
            parts.push(`<div><strong>${escapeHtml(t('smeLeadsTitle'))}</strong></div>`);
            parts.push('<ul style="margin:6px 0 0 18px; padding:0;">');
            parts.push(`<li><strong>${escapeHtml(t('smeLeadSa'))}:</strong> ${escapeHtml(selectedLeads.saLead)}</li>`);
            parts.push(`<li><strong>${escapeHtml(t('smeLeadSales'))}:</strong> ${escapeHtml(selectedLeads.salesLead)}</li>`);
            parts.push(`<li><strong>${escapeHtml(t('smeLeadCsm'))}:</strong> ${escapeHtml(selectedLeads.csmLead)}</li>`);
            parts.push('</ul>');
            parts.push('</div>');
        }

        activePlanningSessions.forEach((session) => {
            parts.push('<div style="margin-top:14px;">');
            parts.push(`<div><strong>${escapeHtml(session.title)}</strong></div>`);
            parts.push(`<div>${escapeHtml(`${session.onlineSessionDay} | ${session.date}`)}</div>`);
            parts.push('<ul style="margin:6px 0 0 18px; padding:0;">');

            availableSchedules.forEach((schedule) => {
                const assignedSME = currentAssignments[schedule]?.[session.id] ?? null;
                const assignedFaculty = enrichFaculty(currentFacultyAssignments[schedule]?.[session.id] ?? null);
                const utcHour = getEffectiveSessionUtcHour(selectedSA, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
                const scheduleLabel = extractScheduleKey(schedule).replace(`${selectedSA} `, '');
                const localLabel = assignedSME
                    ? getLocalTimeForUtcHour(utcHour, assignedSME.office_location, session.date)
                    : (assignedFaculty ? getLocalTimeForUtcHour(utcHour, assignedFaculty.office, session.date) : '-');
                const smeLabel = session.facilitatorType === 'faculty_only' ? FACULTY_LED_SME_LABEL : (assignedSME?.name ?? t('smeSummaryUnassigned'));
                const locationLabel = assignedSME?.office_location ?? assignedFaculty?.office ?? '-';

                parts.push('<li style="margin-bottom:6px;">');
                parts.push(`<div><strong>${escapeHtml(scheduleLabel)}</strong></div>`);
                parts.push(`<div><strong>Time:</strong> ${escapeHtml(`${formatUtcHourLabel(utcHour)} | ${localLabel}`)}</div>`);
                parts.push(`<div><strong>SME:</strong> ${escapeHtml(smeLabel)}</div>`);
                parts.push(`<div><strong>${escapeHtml(t('locationLabel'))}:</strong> ${escapeHtml(locationLabel)}</div>`);
                parts.push(`<div><strong>Faculty:</strong> ${escapeHtml(assignedFaculty?.name ?? '-')}</div>`);
                parts.push('</li>');
            });

            parts.push('</ul>');
            parts.push('</div>');
        });

        parts.push('<div style="margin-top:14px;">');
        parts.push(`<div>${escapeHtml(FOLLOW_UP_NOTE_1)}</div>`);
        parts.push(`<div style="margin-top:10px;">${escapeHtml(FOLLOW_UP_NOTE_2)}</div>`);
        parts.push('</div>');

        return parts.join('');
    };

    const handleCopyCurrentLobSummary = async () => {
        const plainText = buildCurrentLobSummaryText();
        const html = buildCurrentLobSummaryHtml();
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                    'text/html': new Blob([html], { type: 'text/html' }),
                }),
            ]);
        } else {
            await navigator.clipboard.writeText(plainText);
        }
        setCopiedSummary(true);
        window.setTimeout(() => setCopiedSummary(false), 1800);
    };

    const handleOpenTeamsChat = () => {
        if (leadEmails.length === 0) return;
        const users = encodeURIComponent(leadEmails.join(','));
        const topicName = encodeURIComponent(`${selectedSA} - Sol Weeks 5 & 6 Planning`);
        window.open(`https://teams.microsoft.com/l/chat/0/0?users=${users}&topicName=${topicName}`, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="glass-panel animated-fade-in" style={{ marginTop: '2rem', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.5rem', borderRadius: '8px', color: 'var(--primary-color)' }}>
                        <Users size={24} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Subject Matter Experts Assignment</h3>
                </div>
                {/* SME data source badge */}
                {smeStatus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.3rem 0.75rem', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 500,
                            background: smeStatus.source === 'api' ? 'rgba(16,185,129,0.1)' : smeStatus.error ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)',
                            color: smeStatus.source === 'api' ? '#059669' : smeStatus.error ? '#dc2626' : '#6366f1',
                            border: '1px solid',
                            borderColor: smeStatus.source === 'api' ? 'rgba(16,185,129,0.3)' : smeStatus.error ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)',
                        }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                            {smeStatus.source === 'api' ? 'Live data' : smeStatus.error ? 'Offline cache' : 'Cached'}
                            {smeStatus.fetchedAt && (
                                <span style={{ opacity: 0.75 }}>
                                    &nbsp;· {new Date(smeStatus.fetchedAt).toLocaleDateString()}
                                </span>
                            )}
                        </div>
                        {onRefreshSMEs && (
                            <button
                                onClick={onRefreshSMEs}
                                title="Force refresh SME data from API"
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-secondary)', padding: '4px', borderRadius: '6px',
                                    display: 'flex', alignItems: 'center',
                                }}
                            >
                                <RefreshCw size={14} />
                            </button>
                        )}
                        <button
                            onClick={handleCopyCurrentLobSummary}
                            className="btn btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}
                        >
                            {copiedSummary ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                            {copiedSummary ? t('copiedLabel') : t('copySmeLobSummary')}
                        </button>
                        <button
                            onClick={handleOpenTeamsChat}
                            disabled={leadEmails.length === 0}
                            className="btn btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', opacity: leadEmails.length === 0 ? 0.6 : 1 }}
                            title={leadEmails.length === 0 ? 'No lead emails configured for this LoB' : `Open Teams chat with ${leadEmails.length} LoB leads`}
                        >
                            <MessageSquareShare size={14} />
                            {t('openTeamsChat')}
                        </button>
                    </div>
                )}
            </div>

            {/* SA Radio Buttons / Pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
                {uniqueSAs.map(sa => (
                    <button
                        key={sa}
                        onClick={() => setSelectedSA(sa)}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '9999px',
                            border: '1px solid',
                            borderColor: selectedSA === sa ? 'var(--primary-color)' : 'var(--glass-border)',
                            background: selectedSA === sa ? 'var(--primary-color)' : 'rgba(255,255,255,0.5)',
                            color: selectedSA === sa ? 'white' : 'var(--text-primary)',
                            fontWeight: selectedSA === sa ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: selectedSA === sa ? '0 4px 6px -1px rgba(59, 130, 246, 0.3)' : 'none'
                        }}
                    >
                        {sa}
                    </button>
                ))}
            </div>

            {selectedLeads && (
                <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '0.75rem',
                        padding: '1rem',
                        borderRadius: '12px',
                        background: 'rgba(59, 130, 246, 0.06)',
                        border: '1px solid rgba(59, 130, 246, 0.15)',
                    }}>
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                {t('smeLeadSa')}
                            </div>
                            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedLeads.saLead}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                {t('smeLeadSales')}
                            </div>
                            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedLeads.salesLead}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                                {t('smeLeadCsm')}
                            </div>
                            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedLeads.csmLead}</div>
                        </div>
                    </div>
                    {missingLeadEmails.length > 0 && (
                        <div style={{
                            padding: '0.75rem 1rem',
                            borderRadius: '10px',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.22)',
                            color: '#b45309',
                            fontSize: '0.82rem',
                            fontWeight: 500,
                        }}>
                            {t('missingLeadEmails')}: {missingLeadEmails.join(', ')}
                        </div>
                    )}
                </div>
            )}

            {/* Assignment Table */}
            <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '20%' }}>Session Topic</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '25%' }}>Schedule</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '12%' }}>{t('confirmCol')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '30%' }}>Assigned SME</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '15%' }}>LoB</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '10%' }}>Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleSessions.map((session, tIndex) => {
                            const eligibleSMEs = getEligibleSMEs(selectedSA, session.id, smeList);
                            const topicIsLast = tIndex === visibleSessions.length - 1;

                            return availableSchedules.map((schedule, sIndex) => {
                                const assignedSME = currentAssignments[schedule]?.[session.id];
                                const isConfirmed = currentConfirmations[schedule]?.[session.id] ?? false;
                                const scheduleIsLast = sIndex === availableSchedules.length - 1;
                                const showBorder = scheduleIsLast && !topicIsLast;

                                let isOutOfHours = false;
                                const utcHour = getEffectiveSessionUtcHour(selectedSA, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
                                if (assignedSME) {
                                    const localHour = (utcHour + getKnownUtcOffset(assignedSME.office_location, session.date) + 24) % 24;
                                    if (localHour < startHour || localHour >= endHour) {
                                        isOutOfHours = true;
                                    }
                                }

                                return (
                                    <tr
                                        key={`${session.id}-${schedule}`}
                                        style={{
                                            borderBottom: showBorder ? '1px solid #cbd5e1' : (topicIsLast && scheduleIsLast ? 'none' : '1px solid #e2e8f0'),
                                            background: isOutOfHours
                                                ? 'rgba(239, 68, 68, 0.05)'
                                                : (isConfirmed ? 'rgba(16, 185, 129, 0.08)' : 'transparent'),
                                            boxShadow: isConfirmed ? 'inset 4px 0 0 #10b981' : 'none',
                                        }}
                                    >
                                        {sIndex === 0 && (
                                            <td rowSpan={availableSchedules.length} style={{ padding: '1rem', fontWeight: 500, verticalAlign: 'top', borderRight: '1px solid #e2e8f0' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                                    <span>{session.title}</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{session.onlineSessionDay}</span>
                                                    <span style={{ fontSize: '0.75rem', color: '#0369a1' }}>{session.date}</span>
                                                </div>
                                            </td>
                                        )}
                                        <td style={{ padding: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                                                {extractScheduleKey(schedule).replace(`${selectedSA} `, '')}
                                            </div>
                                            {isConfirmed && (
                                                <div
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.3rem',
                                                        marginTop: '0.45rem',
                                                        padding: '0.18rem 0.45rem',
                                                        borderRadius: '9999px',
                                                        background: 'rgba(16, 185, 129, 0.14)',
                                                        color: '#047857',
                                                        fontSize: '0.72rem',
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    <CheckCircle2 size={12} />
                                                    {t('confirmedBadge')}
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSessionTimeAdjustment(schedule, session.id, -0.25)}
                                                    style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', padding: '0.2rem', display: 'flex', cursor: 'pointer' }}
                                                    title="Move session 15 mins earlier"
                                                >
                                                    <Minus size={12} />
                                                </button>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary-color)' }}>
                                                    {formatUtcHourLabel(utcHour)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSessionTimeAdjustment(schedule, session.id, 0.25)}
                                                    style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', padding: '0.2rem', display: 'flex', cursor: 'pointer' }}
                                                    title="Move session 15 mins later"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            </div>
                                            {assignedSME && (
                                                <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', color: isOutOfHours ? 'var(--danger-color)' : 'var(--primary-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    {isOutOfHours && <AlertCircle size={12} />}
                                                    {getLocalTimeForUtcHour(utcHour, assignedSME.office_location, session.date)}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem 1rem' }}>
                                            <button
                                                type="button"
                                                onClick={() => handleConfirmationToggle(schedule, session.id)}
                                                disabled={!assignedSME}
                                                className="btn btn-secondary"
                                                style={{
                                                    minWidth: '102px',
                                                    padding: '0.45rem 0.7rem',
                                                    fontSize: '0.82rem',
                                                    fontWeight: 600,
                                                    borderColor: isConfirmed ? 'rgba(5, 150, 105, 0.35)' : '#cbd5e1',
                                                    background: isConfirmed ? 'rgba(16, 185, 129, 0.12)' : '#fff',
                                                    color: isConfirmed ? '#047857' : 'var(--text-primary)',
                                                    opacity: assignedSME ? 1 : 0.55,
                                                    cursor: assignedSME ? 'pointer' : 'not-allowed',
                                                }}
                                                title={!assignedSME ? t('confirmRequiresSme') : (isConfirmed ? t('unconfirm') : t('confirm'))}
                                            >
                                                {isConfirmed ? t('unconfirm') : t('confirm')}
                                            </button>
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {eligibleSMEs.length > 0 ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                        <UserCircle2 size={16} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                                                        <select
                                                            value={assignedSME?.name || ''}
                                                            onChange={(e) => handleSMEChange(schedule, session.id, e.target.value)}
                                                            disabled={isConfirmed}
                                                            style={{
                                                                width: '100%',
                                                                padding: '0.5rem 0.5rem 0.5rem 2.5rem',
                                                                borderRadius: '6px',
                                                                border: (assignedSME && getConflict(assignedSME.name, schedule, session.id, selectedSA)) ? '1px solid var(--danger-color)' : (isConfirmed ? '1px solid #bbf7d0' : (assignedSME ? '1px solid #cbd5e1' : '1px solid #fecaca')),
                                                                background: (assignedSME && getConflict(assignedSME.name, schedule, session.id, selectedSA)) ? 'rgba(239, 68, 68, 0.02)' : (isConfirmed ? '#f1f5f9' : (assignedSME ? '#fff' : '#fef2f2')),
                                                                fontSize: '0.9rem',
                                                                color: isConfirmed ? '#64748b' : 'var(--text-primary)',
                                                                cursor: isConfirmed ? 'not-allowed' : 'pointer',
                                                                appearance: 'none',
                                                                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                                                                opacity: isConfirmed ? 0.9 : 1,
                                                            }}
                                                        >
                                                            <option value="" disabled>Select SME...</option>
                                                            {eligibleSMEs.map(sme => (
                                                                <option key={sme.name} value={sme.name}>{sme.name}</option>
                                                            ))}
                                                        </select>
                                                        {/* Custom dropdown arrow */}
                                                        <div style={{ position: 'absolute', right: '0.75rem', pointerEvents: 'none', color: 'var(--text-secondary)' }}>▼</div>
                                                    </div>
                                                    {assignedSME && getConflict(assignedSME.name, schedule, session.id, selectedSA) && (
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'flex-start', gap: '0.25rem', marginTop: '0.25rem', lineHeight: '1.2' }}>
                                                            <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                            <span>Time conflict - SME already assigned to "{getConflict(assignedSME.name, schedule, session.id, selectedSA)}"</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span style={{ fontSize: '0.85rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem' }}>
                                                    No eligible SMEs
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {assignedSME ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    <Building2 size={14} color="var(--text-secondary)" />
                                                    {assignedSME.lob}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>-</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {assignedSME ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    <MapPin size={14} color="var(--text-secondary)" />
                                                    {assignedSME.office_location}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>-</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            });
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
