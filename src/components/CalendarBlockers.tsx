import { useMemo, useState, type CSSProperties } from 'react';
import { CalendarPlus, Download, Copy, CheckCircle2, UserSquare2, Presentation, Users } from 'lucide-react';
import { sessions, autoAssignSMEs } from '../lib/smeMatcher';
import type { SME } from '../lib/smeMatcher';
import { autoAssignFaculty, enrichFaculty } from '../lib/facultyMatcher';
import type { Faculty } from '../lib/facultyMatcher';
import { activePlanningSessions } from '../lib/sessionCatalog';
import { extractScheduleKey, getEffectiveSessionUtcHour, formatUtcHourLabel, getLocalTimeForUtcHour } from '../lib/timezones';
import type { SmeAssignments } from './SMESchedule';
import type { FacultyAssignments } from './FacultySchedule';
import { useI18n } from '../i18n';

interface CalendarBlockersProps {
    schedulesBySA: Record<string, Set<string>>;
    startHour: number;
    endHour: number;
    facultyStartHour?: number;
    sessionTimeOverrides: Record<string, number>;
    sessionInstanceTimeOverrides: Record<string, number>;
    manualSmeAssignments: SmeAssignments;
    manualFacultyAssignments: FacultyAssignments;
    smeList: SME[];
    projectName?: string | null;
    versionLabel?: string | null;
}

type AudienceMode = 'both' | 'smes' | 'faculty';
type CometMode = 'draft' | 'send';

interface CalendarBlockerRow {
    key: string;
    solutionArea: string;
    schedule: string;
    sessionId: typeof sessions[number]['id'];
    sessionTopic: string;
    sessionDate: string;
    utcHour: number;
    durationMinutes: number;
    assignedSME: SME | null;
    assignedFaculty: Faculty | null;
    lob: string;
    recipientEmails: string[];
    recipientNames: string[];
    missingEmails: string[];
}

const escapeIcsText = (value: string): string =>
    value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');

const toUtcIcsDate = (date: Date): string => {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
};

const buildUtcDateForSession = (sessionDateLabel: string, utcHour: number): Date => {
    const baseDate = new Date(`${sessionDateLabel} 00:00:00 UTC`);
    return new Date(Date.UTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth(),
        baseDate.getUTCDate(),
        utcHour,
        0,
        0,
        0
    ));
};

const downloadTextFile = (filename: string, content: string, mime = 'text/calendar;charset=utf-8') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

const OUTLOOK_WEB_URL = 'https://outlook.office.com/mail/?realm=sap.com&login_hint=fernando.sanchez@sap.com';

const formatUtcDate = (date: Date): string => date.toISOString().slice(0, 10);
const formatUtcTime = (date: Date): string => date.toISOString().slice(11, 16);

const buildEventTitle = (row: CalendarBlockerRow): string =>
    `Solution Weeks | ${row.solutionArea} | ${row.sessionTopic} | ${extractScheduleKey(row.schedule).replace(`${row.solutionArea} `, '')}`;

const buildEventBody = (row: CalendarBlockerRow, projectName?: string | null, versionLabel?: string | null): string =>
    [
        `Project: ${projectName || 'Current Project'}`,
        versionLabel ? `Version: ${versionLabel}` : null,
        `Solution Area: ${row.solutionArea}`,
        `Session Topic: ${row.sessionTopic}`,
        `Schedule: ${extractScheduleKey(row.schedule)}`,
        `UTC: ${formatUtcHourLabel(row.utcHour)}`,
        row.assignedSME ? `SME: ${row.assignedSME.name}${row.assignedSME.email ? ` <${row.assignedSME.email}>` : ''}` : null,
        row.assignedFaculty ? `Faculty: ${row.assignedFaculty.name}${row.assignedFaculty.email ? ` <${row.assignedFaculty.email}>` : ''}` : null,
        row.missingEmails.length > 0 ? `Missing emails (do not invent): ${row.missingEmails.join(', ')}` : null,
    ].filter(Boolean).join('\n');

export function CalendarBlockers({
    schedulesBySA,
    startHour,
    endHour,
    facultyStartHour,
    sessionTimeOverrides,
    sessionInstanceTimeOverrides,
    manualSmeAssignments,
    manualFacultyAssignments,
    smeList,
    projectName,
    versionLabel,
}: CalendarBlockersProps) {
    const { t } = useI18n();
    const [audienceMode, setAudienceMode] = useState<AudienceMode>('both');
    const [cometMode, setCometMode] = useState<CometMode>('draft');
    const [selectedLob, setSelectedLob] = useState<string>('all');
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const effectiveFacultyStartHour = facultyStartHour ?? startHour;

    const rows = useMemo<CalendarBlockerRow[]>(() => {
        const builtRows: CalendarBlockerRow[] = [];
        const allSAs = Object.keys(schedulesBySA).sort();

        for (const sa of allSAs) {
            const schedulesForSA = Array.from(schedulesBySA[sa] || []).sort();
            const autoSme = autoAssignSMEs(sa, schedulesForSA, startHour, endHour, smeList);
            const autoFac = autoAssignFaculty(sa, schedulesForSA, effectiveFacultyStartHour, endHour);
            const smeAssignmentsForSA = manualSmeAssignments[sa] || autoSme;
            const facAssignmentsForSA = manualFacultyAssignments[sa] || autoFac;

            for (const schedule of schedulesForSA) {
                for (const session of activePlanningSessions) {
                    const utcHour = getEffectiveSessionUtcHour(sa, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
                    const assignedSME = smeAssignmentsForSA[schedule]?.[session.id] ?? null;
                    const assignedFaculty = enrichFaculty(facAssignmentsForSA[schedule]?.[session.id] ?? null);

                    const recipientEmails = new Set<string>();
                    const recipientNames = new Set<string>();
                    const missingEmails = new Set<string>();

                    if ((audienceMode === 'both' || audienceMode === 'smes') && assignedSME) {
                        recipientNames.add(assignedSME.name);
                        if (assignedSME.email) recipientEmails.add(assignedSME.email);
                        else missingEmails.add(assignedSME.name);
                    }

                    if ((audienceMode === 'both' || audienceMode === 'faculty') && assignedFaculty) {
                        recipientNames.add(assignedFaculty.name);
                        if (assignedFaculty.email) recipientEmails.add(assignedFaculty.email);
                        else missingEmails.add(assignedFaculty.name);
                    }

                    if (recipientNames.size === 0) continue;

                    builtRows.push({
                        key: `${sa}__${schedule}__${session.id}__${audienceMode}`,
                        solutionArea: sa,
                        schedule,
                        sessionId: session.id,
                        sessionTopic: session.title,
                        sessionDate: session.date,
                        utcHour,
                        durationMinutes: 90,
                        assignedSME,
                        assignedFaculty,
                        lob: assignedSME?.lob || '',
                        recipientEmails: Array.from(recipientEmails).sort(),
                        recipientNames: Array.from(recipientNames).sort(),
                        missingEmails: Array.from(missingEmails).sort(),
                    });
                }
            }
        }

        return builtRows;
    }, [schedulesBySA, startHour, endHour, smeList, manualSmeAssignments, manualFacultyAssignments, effectiveFacultyStartHour, sessionInstanceTimeOverrides, sessionTimeOverrides, audienceMode]);

    const availableLobs = useMemo(
        () => Array.from(new Set(rows.map(row => row.lob).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [rows]
    );

    const visibleRows = useMemo(
        () => rows.filter(row => selectedLob === 'all' || row.lob === selectedLob),
        [rows, selectedLob]
    );

    const selectedRows = visibleRows.filter(row => selectedKeys.has(row.key));
    const allSelected = visibleRows.length > 0 && selectedRows.length === visibleRows.length;

    const toggleAll = () => {
        if (allSelected) setSelectedKeys(new Set());
        else setSelectedKeys(new Set(visibleRows.map(row => row.key)));
    };

    const toggleOne = (key: string) => {
        setSelectedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const buildIcs = (targetRows: CalendarBlockerRow[]) => {
        const now = new Date();
        const events = targetRows.map(row => {
            const start = buildUtcDateForSession(row.sessionDate, row.utcHour);
            const end = new Date(start.getTime() + (row.durationMinutes * 60 * 1000));
            const title = buildEventTitle(row);
            const description = buildEventBody(row, projectName, versionLabel);

            const attendees = row.recipientEmails.map(email =>
                `ATTENDEE;CN=${escapeIcsText(email)};ROLE=REQ-PARTICIPANT:mailto:${email}`
            ).join('\r\n');

            return [
                'BEGIN:VEVENT',
                `UID:${row.key}@schedule-app.local`,
                `DTSTAMP:${toUtcIcsDate(now)}`,
                `DTSTART:${toUtcIcsDate(start)}`,
                `DTEND:${toUtcIcsDate(end)}`,
                `SUMMARY:${escapeIcsText(title)}`,
                `DESCRIPTION:${escapeIcsText(description)}`,
                'STATUS:CONFIRMED',
                'TRANSP:OPAQUE',
                attendees,
                'END:VEVENT',
            ].filter(Boolean).join('\r\n');
        }).join('\r\n');

        return [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Schedule App//Calendar Blockers//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:REQUEST',
            events,
            'END:VCALENDAR',
        ].join('\r\n');
    };

    const handleDownloadOne = (row: CalendarBlockerRow) => {
        const filename = `blocker_${row.solutionArea}_${row.sessionTopic}_${row.sessionDate.replace(/[^0-9A-Za-z]+/g, '-')}.ics`;
        downloadTextFile(filename, buildIcs([row]));
    };

    const handleDownloadMany = (targetRows: CalendarBlockerRow[], filename: string) => {
        if (targetRows.length === 0) return;
        downloadTextFile(filename, buildIcs(targetRows));
    };

    const copyRecipients = async (row: CalendarBlockerRow) => {
        const text = row.recipientEmails.join('; ');
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopiedKey(row.key);
        window.setTimeout(() => setCopiedKey(current => current === row.key ? null : current), 1800);
    };

    const buildCometPrompt = (targetRows: CalendarBlockerRow[]) => {
        const actionInstruction = cometMode === 'send'
            ? 'When each event is fully populated and verified, send the invitation.'
            : 'Save each event as a draft only. Do not send anything.';

        const eventsSection = targetRows.map((row, index) => {
            const start = buildUtcDateForSession(row.sessionDate, row.utcHour);
            const end = new Date(start.getTime() + (row.durationMinutes * 60 * 1000));
            return [
                `Event ${index + 1}`,
                `- Subject: ${buildEventTitle(row)}`,
                `- Date (UTC): ${formatUtcDate(start)}`,
                `- Start time (UTC): ${formatUtcTime(start)}`,
                `- End time (UTC): ${formatUtcTime(end)}`,
                `- Recipients: ${row.recipientEmails.length > 0 ? row.recipientEmails.join('; ') : 'none available'}`,
                `- Missing emails (do not invent): ${row.missingEmails.length > 0 ? row.missingEmails.join(', ') : 'none'}`,
                `- Body:\n${buildEventBody(row, projectName, versionLabel).split('\n').map(line => `  ${line}`).join('\n')}`,
            ].join('\n');
        }).join('\n\n');

        return [
            'Use the current logged-in Outlook Web session to create calendar meeting invites.',
            `Open: ${OUTLOOK_WEB_URL}`,
            'Navigate to Calendar.',
            'For each event below, create a new calendar event/meeting.',
            'Set the event timezone explicitly to UTC before entering the date and time.',
            'Before creating each event, check the target date in the calendar for an existing event with the exact same subject and same UTC start time. If it already exists, skip that event and continue.',
            'Only use the recipient emails listed below. Do not invent or guess missing email addresses.',
            actionInstruction,
            '',
            'Important validation rules:',
            '- Keep duration exactly 90 minutes unless the event block below says otherwise.',
            '- Do not modify the subject text.',
            '- Preserve line breaks in the body if possible.',
            '- If Outlook asks whether to save changes or send updates, follow the selected mode strictly.',
            '',
            eventsSection,
        ].join('\n');
    };

    const copyCometPrompt = async (targetRows: CalendarBlockerRow[], key: string) => {
        if (targetRows.length === 0) return;
        await navigator.clipboard.writeText(buildCometPrompt(targetRows));
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey(current => current === key ? null : current), 2200);
    };

    return (
        <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>{t('blockersTitle')}</h3>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{t('blockersDesc')}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary" onClick={() => setAudienceMode('both')} style={{ background: audienceMode === 'both' ? '#e2e8f0' : 'white' }}>
                            <Users size={14} /> {t('blockersAudienceBoth')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setAudienceMode('smes')} style={{ background: audienceMode === 'smes' ? '#e2e8f0' : 'white' }}>
                            <UserSquare2 size={14} /> {t('navSMEs')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setAudienceMode('faculty')} style={{ background: audienceMode === 'faculty' ? '#e2e8f0' : 'white' }}>
                            <Presentation size={14} /> {t('navFaculty')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setCometMode('draft')} style={{ background: cometMode === 'draft' ? '#e2e8f0' : 'white' }}>
                            {t('blockersCometModeDraft')}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setCometMode('send')} style={{ background: cometMode === 'send' ? '#e2e8f0' : 'white' }}>
                            {t('blockersCometModeSend')}
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <span>{t('lobLabel')}:</span>
                        <select
                            value={selectedLob}
                            onChange={(e) => {
                                setSelectedLob(e.target.value);
                                setSelectedKeys(new Set());
                            }}
                            style={{
                                padding: '0.45rem 0.6rem',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                background: '#fff',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem',
                            }}
                        >
                            <option value="all">{t('blockersAllLobs')}</option>
                            {availableLobs.map(lob => (
                                <option key={lob} value={lob}>{lob}</option>
                            ))}
                        </select>
                    </label>
                    <button className="btn btn-secondary" onClick={toggleAll}>
                        {allSelected ? t('blockersClearSelection') : t('blockersSelectAll')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        disabled={selectedRows.length === 0}
                        onClick={() => handleDownloadMany(selectedRows, 'selected_blockers.ics')}
                    >
                        <Download size={15} /> {t('blockersDownloadSelected')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        disabled={visibleRows.length === 0}
                        onClick={() => handleDownloadMany(visibleRows, 'all_blockers.ics')}
                    >
                        <CalendarPlus size={15} /> {t('blockersDownloadAll')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        disabled={selectedRows.length === 0}
                        onClick={() => copyCometPrompt(selectedRows, '__comet_selected__')}
                    >
                        {copiedKey === '__comet_selected__' ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                        {t('blockersPromptSelected')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        disabled={visibleRows.length === 0}
                        onClick={() => copyCometPrompt(visibleRows, '__comet_all__')}
                    >
                        {copiedKey === '__comet_all__' ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                        {t('blockersPromptAll')}
                    </button>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
                        {t('blockersSessionsCount')}: <strong style={{ marginLeft: '0.35rem', color: 'var(--text-primary)' }}>{visibleRows.length}</strong>
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1340, fontSize: '0.88rem' }}>
                    <thead>
                        <tr style={{ background: 'rgba(248,250,252,0.95)', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={thStyle}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                            <th style={thStyle}>{t('solutionArea')}</th>
                            <th style={thStyle}>{t('sessionTopic')}</th>
                            <th style={thStyle}>{t('scheduleLabel')}</th>
                            <th style={thStyle}>{t('lobLabel')}</th>
                            <th style={thStyle}>{t('utcHour')}</th>
                            <th style={thStyle}>{t('blockersLocalPreview')}</th>
                            <th style={thStyle}>{t('blockersRecipients')}</th>
                            <th style={thStyle}>{t('blockersRecipientEmails')}</th>
                            <th style={thStyle}>{t('details')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map((row, idx) => (
                            <tr key={row.key} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(248,250,252,0.55)' }}>
                                <td style={tdStyle}>
                                    <input type="checkbox" checked={selectedKeys.has(row.key)} onChange={() => toggleOne(row.key)} />
                                </td>
                                <td style={tdStyle}>{row.solutionArea}</td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        <span style={{ fontWeight: 600 }}>{row.sessionTopic}</span>
                                        <span style={{ fontSize: '0.75rem', color: '#0369a1' }}>{row.sessionDate}</span>
                                    </div>
                                </td>
                                <td style={tdStyle}>{extractScheduleKey(row.schedule).replace(`${row.solutionArea} `, '')}</td>
                                <td style={tdStyle}>{row.lob || '—'}</td>
                                <td style={tdStyle}><span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>{formatUtcHourLabel(row.utcHour)}</span></td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        {row.assignedSME && <span>SME: {getLocalTimeForUtcHour(row.utcHour, row.assignedSME.office_location, row.sessionDate)}</span>}
                                        {row.assignedFaculty && <span>Faculty: {getLocalTimeForUtcHour(row.utcHour, row.assignedFaculty.office, row.sessionDate)}</span>}
                                    </div>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        {row.assignedSME && <span>SME: {row.assignedSME.name}</span>}
                                        {row.assignedFaculty && <span>Faculty: {row.assignedFaculty.name}</span>}
                                    </div>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <div style={{ fontSize: '0.8rem' }}>
                                            {row.recipientEmails.length > 0 ? row.recipientEmails.join('; ') : <span style={{ color: '#b45309' }}>{t('blockersNoRecipientEmails')}</span>}
                                        </div>
                                        {row.missingEmails.length > 0 && (
                                            <div style={{ fontSize: '0.74rem', color: '#b45309' }}>
                                                {t('blockersMissingEmails')}: {row.missingEmails.join(', ')}
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        <button className="btn btn-secondary" onClick={() => handleDownloadOne(row)} style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}>
                                            <Download size={13} /> {t('blockersDownloadIcs')}
                                        </button>
                                        <button
                                            className="btn btn-secondary"
                                            disabled={row.recipientEmails.length === 0}
                                            onClick={() => copyRecipients(row)}
                                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}
                                        >
                                            {copiedKey === row.key ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                                            {t('blockersCopyRecipients')}
                                        </button>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => copyCometPrompt([row], `__comet_${row.key}__`)}
                                            style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem' }}
                                        >
                                            {copiedKey === `__comet_${row.key}__` ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                                            {t('blockersPromptForComet')}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {visibleRows.length === 0 && (
                            <tr>
                                <td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    {t('noSessions')}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const thStyle: CSSProperties = {
    padding: '0.85rem 1rem',
    textAlign: 'left',
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const tdStyle: CSSProperties = {
    padding: '0.9rem 1rem',
    verticalAlign: 'top',
};
