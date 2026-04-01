import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { Download, Upload, Users, AlertTriangle, Calendar as CalendarIcon } from 'lucide-react';
import type { StudentRecord } from '../lib/excelParser';
import { assignEvaluators, type EvaluationEngineOutput, type VatGroup } from '../lib/evaluationEngine';
import type { FacultyAssignments } from './FacultySchedule';
import type { EvaluatorRecord } from '../lib/excelParser';
import { SUN_THU_COUNTRIES } from '../lib/timezones';
import evaluatorsData from '../evaluators-data.json';

interface EvaluationsProps {
    records: StudentRecord[];
    facultyAssignments: FacultyAssignments;
    output: EvaluationEngineOutput | null;
    onOutputChange: (v: EvaluationEngineOutput | null | ((p: EvaluationEngineOutput | null) => EvaluationEngineOutput | null)) => void;
}

interface EvaluationExportPayloadV2 {
    schemaVersion: 'sessionzilla-evaluations-v2';
    exportedAt: string;
    app: string;
    inputs: {
        evaluationDate: string;
        includeRAD: boolean;
        recordsCount: number;
        evaluatorsCount: number;
        facultyAssignments: FacultyAssignments;
    };
    records: StudentRecord[];
    evaluators: EvaluatorRecord[];
    output: EvaluationEngineOutput | null;
}

interface LegacyEvaluationAssignment {
    evaluatorName: string;
    sa: string;
    utcOffset: number;
    vatsAssigned: Array<{
        vatName: string;
        vatSa: string;
        vatAverageUtcOffset: number;
        membersCount?: number;
    }>;
}

interface LegacyEvaluationExportPayload {
    evaluationDate?: string;
    includeRAD?: boolean;
    assignments?: LegacyEvaluationAssignment[];
    unassignedVats?: Array<{
        vatName: string;
        sa: string;
        averageUtcOffset: number;
        membersCount?: number;
    }>;
}

interface EvaluationTimingWindow {
    defaultDateUtc?: string;
    middleEastExceptionDateUtc?: string;
    meetingDurationMinutes?: number;
    timezone?: string;
    notes?: string[];
}

interface TimedVatGroup extends VatGroup {
    suggestedDay?: string;
    suggestedUtcSlot?: string;
    evaluatorLocalSlot?: string;
    vatAvgLocalStart?: string;
    vatMemberLocalRange?: string;
    timingQuality?: string;
    suggestedDateUtc?: string;
    suggestedMeetingStartUtc?: string;
    suggestedMeetingEndUtc?: string;
    suggestedMeetingUtcLabel?: string;
}

interface EvaluationOutputWithTiming extends EvaluationEngineOutput {
    schedulingWindow?: EvaluationTimingWindow;
}

export function Evaluations({ records, facultyAssignments, output, onOutputChange }: EvaluationsProps) {
    const evaluators = evaluatorsData as EvaluatorRecord[];
    const [evalDate, setEvalDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [includeRAD, setIncludeRAD] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const hasAutoRun = useRef(false);
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    const timingOutput = output as EvaluationOutputWithTiming | null;

    const handleRunAssignment = useCallback(() => {
        setNotice(null);
        const dateObj = new Date(evalDate);
        if (isNaN(dateObj.getTime())) {
            setError("Invalid date selected.");
            return;
        }

        const result = assignEvaluators(records, evaluators, facultyAssignments, dateObj, includeRAD);
        onOutputChange(result);
    }, [records, evaluators, facultyAssignments, evalDate, includeRAD, onOutputChange]);

    // Auto-run simulation when component mounts if not already simulated
    useEffect(() => {
        if (!output && records.length > 0 && !hasAutoRun.current) {
            hasAutoRun.current = true;
            const timer = setTimeout(() => {
                handleRunAssignment();
            }, 0);
            return () => clearTimeout(timer);
        }
    }, [records, output, handleRunAssignment]);

    const handleMoveVat = (vatName: string, targetEvaluatorName: string) => {
        if (!output) return;
        setNotice(null);

        onOutputChange(prev => {
            if (!prev) return prev;

            // 1. Find VAT and original evaluator
            let vatToMove: VatGroup | null = null;
            const nextAssignments = prev.assignments.map(assig => {
                const vatIdx = assig.assignedVats.findIndex(v => v.name === vatName);
                if (vatIdx !== -1) {
                    vatToMove = assig.assignedVats[vatIdx];
                    return {
                        ...assig,
                        assignedVats: assig.assignedVats.filter((_, i) => i !== vatIdx)
                    };
                }
                return assig;
            });

            // If not found in assignments, check unassigned
            let nextUnassigned = prev.unassignedVats;
            if (!vatToMove) {
                const unIdx = nextUnassigned.findIndex(v => v.name === vatName);
                if (unIdx !== -1) {
                    vatToMove = nextUnassigned[unIdx];
                    nextUnassigned = nextUnassigned.filter((_, i) => i !== unIdx);
                }
            }

            if (!vatToMove) return prev;

            // 2. Add to target evaluator
            const updatedAssignments = nextAssignments.map(assig => {
                if (assig.evaluator['Faculty Name'] === targetEvaluatorName) {
                    return {
                        ...assig,
                        assignedVats: [...assig.assignedVats, vatToMove!].sort((a, b) => a.name.localeCompare(b.name))
                    };
                }
                return assig;
            });

            return {
                ...prev,
                assignments: updatedAssignments,
                unassignedVats: nextUnassigned
            };
        });
    };

    const buildFullExportPayload = (): EvaluationExportPayloadV2 => ({
        schemaVersion: 'sessionzilla-evaluations-v2',
        exportedAt: new Date().toISOString(),
        app: 'Sessionzilla',
        inputs: {
            evaluationDate: evalDate,
            includeRAD,
            recordsCount: records.length,
            evaluatorsCount: evaluators.length,
            facultyAssignments,
        },
        records,
        evaluators,
        output,
    });

    const handleDownloadJson = () => {
        const exportData = buildFullExportPayload();
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Evaluations_Assignment_${evalDate}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const isEvaluationOutputLike = (value: unknown): value is EvaluationEngineOutput => {
        if (!value || typeof value !== 'object') return false;
        const candidate = value as EvaluationEngineOutput;
        return Array.isArray(candidate.assignments) && Array.isArray(candidate.unassignedVats);
    };

    const hasTimingMetadata = (value: unknown): value is EvaluationOutputWithTiming => {
        return isEvaluationOutputLike(value) && typeof (value as EvaluationOutputWithTiming).schedulingWindow === 'object';
    };

    const hydrateLegacyPayload = (payload: LegacyEvaluationExportPayload): EvaluationEngineOutput | null => {
        if (!Array.isArray(payload.assignments) || !Array.isArray(payload.unassignedVats)) {
            return null;
        }

        const assignments = payload.assignments.map((assignment) => {
            const evaluatorRecord = evaluators.find((e) => e['Faculty Name'] === assignment.evaluatorName);
            return {
                evaluator: {
                    ...(evaluatorRecord ?? {
                        'Faculty Name': assignment.evaluatorName,
                        Role: 'Unknown',
                        'Country Location': '',
                        'City Location': '',
                    }),
                    sas: [],
                    utcOffset: assignment.utcOffset,
                },
                sa: assignment.sa,
                utcOffset: assignment.utcOffset,
                assignedVats: assignment.vatsAssigned.map((vat) => ({
                    name: vat.vatName,
                    sa: vat.vatSa,
                    utcOffset: vat.vatAverageUtcOffset,
                    members: [],
                })),
            };
        });

        const unassignedVats = payload.unassignedVats.map((vat) => ({
            name: vat.vatName,
            sa: vat.sa,
            utcOffset: vat.averageUtcOffset,
            members: [],
        }));

        return { assignments, unassignedVats };
    };

    const applyImportedPayload = (parsed: unknown) => {
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('JSON structure is not valid.');
        }

        const packagePayload = parsed as Partial<EvaluationExportPayloadV2> & LegacyEvaluationExportPayload & { output?: unknown };

        if (packagePayload.inputs?.evaluationDate) {
            setEvalDate(packagePayload.inputs.evaluationDate);
        } else if (packagePayload.evaluationDate) {
            setEvalDate(packagePayload.evaluationDate);
        }

        if (typeof packagePayload.inputs?.includeRAD === 'boolean') {
            setIncludeRAD(packagePayload.inputs.includeRAD);
        } else if (typeof packagePayload.includeRAD === 'boolean') {
            setIncludeRAD(packagePayload.includeRAD);
        }

        if (isEvaluationOutputLike(packagePayload.output)) {
            onOutputChange(packagePayload.output);
            setNotice('Evaluation results loaded from JSON.');
            setError(null);
            return;
        }

        if (isEvaluationOutputLike(parsed)) {
            onOutputChange(parsed);
            setNotice('Evaluation results loaded from JSON.');
            setError(null);
            return;
        }

        const legacyHydrated = hydrateLegacyPayload(packagePayload);
        if (legacyHydrated) {
            onOutputChange(legacyHydrated);
            setNotice('Legacy evaluation results loaded from JSON.');
            setError(null);
            return;
        }

        throw new Error('JSON does not contain recognizable evaluation results.');
    };

    const handleUploadJson = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            applyImportedPayload(parsed);
        } catch (uploadError) {
            const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
            setError(`Failed to load evaluation JSON: ${message}`);
            setNotice(null);
        } finally {
            event.target.value = '';
        }
    };

    return (
        <div className="evaluations-container" style={{ padding: '2rem' }}>
            <div className="header" style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-color)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Users className="text-primary" /> Evaluation Assignments
                </h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                    VATs are automatically assigned to the evaluators embedded in the application based on timezone proximity and Solution Area matching.
                </p>
            </div>

            {error && (
                <div className="error-banner" style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', borderRadius: '0.5rem' }}>
                    {error}
                </div>
            )}

            {notice && (
                <div className="notice-banner" style={{ marginBottom: '1.5rem', padding: '1rem', background: '#ecfdf5', border: '1px solid #86efac', color: '#166534', borderRadius: '0.5rem' }}>
                    {notice}
                </div>
            )}

            <div className="controls glass-panel" style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', alignItems: 'flex-end', marginBottom: '2rem' }}>
                <div className="form-group">
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Users size={16} /> Evaluators Pool
                    </label>
                    <div style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                        {evaluators.length} Evaluators Registered
                    </div>
                </div>

                <div className="form-group">
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <CalendarIcon size={16} /> Evaluation Date
                    </label>
                    <input 
                        type="date" 
                        value={evalDate} 
                        onChange={(e) => setEvalDate(e.target.value)} 
                        className="text-input" 
                    />
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem' }}>
                    <input 
                        type="checkbox" 
                        id="include-rad" 
                        checked={includeRAD} 
                        onChange={(e) => setIncludeRAD(e.target.checked)} 
                        style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--primary-color)' }}
                    />
                    <label htmlFor="include-rad" style={{ fontWeight: 500, color: 'var(--text-color)' }}>
                        Include 'RAD' Role
                    </label>
                </div>

                <div className="form-group">
                    <input
                        ref={uploadInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={handleUploadJson}
                        style={{ display: 'none' }}
                    />
                    <button
                        onClick={() => uploadInputRef.current?.click()}
                        className="btn btn-secondary w-full"
                        style={{ justifyContent: 'center' }}
                    >
                        <Upload size={16} /> Upload JSON
                    </button>
                </div>

                <div className="form-group">
                    <button 
                        onClick={handleRunAssignment} 
                        className="btn btn-primary w-full" 
                        style={{ justifyContent: 'center' }}
                    >
                        Run Assignment
                    </button>
                </div>
            </div>

            {output && (
                <div className="output-section animated-fade-in">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>Results</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button onClick={handleDownloadJson} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Download size={16} /> Download Full JSON
                            </button>
                        </div>
                    </div>

                    {hasTimingMetadata(timingOutput) && timingOutput.schedulingWindow && (
                        <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                            <h4 style={{ marginBottom: '0.75rem', fontSize: '1rem', fontWeight: 700, color: '#166534' }}>
                                Suggested Evaluation Window
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                {timingOutput.schedulingWindow.timezone && (
                                    <div>
                                        <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#15803d' }}>Timezone</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{timingOutput.schedulingWindow.timezone}</div>
                                    </div>
                                )}
                                {timingOutput.schedulingWindow.defaultDateUtc && (
                                    <div>
                                        <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#15803d' }}>Default Date (UTC)</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{timingOutput.schedulingWindow.defaultDateUtc}</div>
                                    </div>
                                )}
                                {timingOutput.schedulingWindow.middleEastExceptionDateUtc && (
                                    <div>
                                        <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#15803d' }}>Middle East Exception</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{timingOutput.schedulingWindow.middleEastExceptionDateUtc}</div>
                                    </div>
                                )}
                                {timingOutput.schedulingWindow.meetingDurationMinutes && (
                                    <div>
                                        <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#15803d' }}>Duration</div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{timingOutput.schedulingWindow.meetingDurationMinutes} minutes</div>
                                    </div>
                                )}
                            </div>
                            {Array.isArray(timingOutput.schedulingWindow.notes) && timingOutput.schedulingWindow.notes.length > 0 && (
                                <div style={{ marginTop: '0.85rem' }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#15803d', marginBottom: '0.4rem' }}>Notes</div>
                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#166534' }}>
                                        {timingOutput.schedulingWindow.notes.map((note, idx) => (
                                            <li key={idx} style={{ marginBottom: '0.25rem' }}>{note}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {output.unassignedVats.length > 0 && (
                        <div className="alert-box" style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', padding: '1rem', borderRadius: '0.5rem', marginBottom: '2rem' }}>
                            <h4 style={{ color: '#b91c1c', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <AlertTriangle size={18} /> {output.unassignedVats.length} Unassigned VATs
                            </h4>
                            <p style={{ color: '#991b1b', fontSize: '0.85rem' }}>
                                These VATs could not be assigned because no evaluators were within a 4-hour timezone difference.
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                                {output.unassignedVats.map(v => (
                                    <div key={v.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', background: '#fee2e2', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid #fca5a5' }}>
                                        <span style={{ color: '#991b1b', fontSize: '0.75rem', fontWeight: 600 }}>
                                            {v.name} ({v.sa}, UTC {v.utcOffset > 0 ? '+' : ''}{v.utcOffset.toFixed(1)})
                                        </span>
                                        <select
                                            value=""
                                            onChange={(e) => handleMoveVat(v.name, e.target.value)}
                                            style={{ fontSize: '0.7rem', padding: '2px', borderRadius: '4px', border: '1px solid #fca5a5' }}
                                        >
                                            <option value="" disabled>Assign to...</option>
                                            {output.assignments.map(a => (
                                                <option key={a.evaluator['Faculty Name']} value={a.evaluator['Faculty Name']}>
                                                    {a.evaluator['Faculty Name']} (UTC {a.utcOffset > 0 ? '+' : ''}{a.utcOffset})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="assignments-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {output.assignments.map((evaluatorAssig, idx) => (
                            <div key={idx} className="glass-panel" style={{ padding: '1.25rem', borderTop: '4px solid var(--primary-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                    <div>
                                        <h4 style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--text-color)', marginBottom: '0.25rem' }}>
                                            {evaluatorAssig.evaluator['Faculty Name']}
                                        </h4>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                                            <span><strong>Timezone:</strong> UTC {evaluatorAssig.utcOffset > 0 ? '+' : ''}{evaluatorAssig.utcOffset}</span>
                                        </div>
                                    </div>
                                    <div style={{ background: 'var(--bg-tertiary)', padding: '0.35rem 0.75rem', borderRadius: '1rem', fontWeight: 'bold', color: 'var(--primary-color)', fontSize: '0.85rem' }}>
                                        {evaluatorAssig.assignedVats.length} VATs
                                    </div>
                                </div>
                                
                                <div className="vat-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {evaluatorAssig.assignedVats.length === 0 ? (
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '1rem 0' }}>
                                            No VATs assigned
                                         </div>
                                    ) : (
                                        evaluatorAssig.assignedVats.map(v => {
                                            const timedVat = v as TimedVatGroup;
                                            const isSunThuVat = v.members?.some(m => SUN_THU_COUNTRIES.some(c => (m.Country || '').toLowerCase().includes(c)));
                                            return (
                                                <div key={v.name} style={{ 
                                                    background: isSunThuVat ? '#f0fdf4' : '#f8fafc', 
                                                    padding: '0.75rem', 
                                                    borderRadius: '0.375rem', 
                                                    border: `1px solid ${isSunThuVat ? '#10b981' : '#e2e8f0'}`, 
                                                    fontSize: '0.85rem' 
                                                }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--text-color)', marginBottom: '0.35rem' }}>
                                                    <span>{v.name}</span>
                                                    <span>UTC {v.utcOffset > 0 ? '+' : ''}{v.utcOffset.toFixed(1)}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                                        Gap: <strong>{Math.abs(v.utcOffset - evaluatorAssig.utcOffset).toFixed(1)} hrs</strong>
                                                    </div>
                                                    <select
                                                        value=""
                                                        onChange={(e) => handleMoveVat(v.name, e.target.value)}
                                                        style={{ 
                                                            fontSize: '0.7rem', 
                                                            padding: '2px 4px', 
                                                            borderRadius: '4px', 
                                                            border: '1px solid #e2e8f0',
                                                            background: 'white',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        <option value="" disabled>Move...</option>
                                                        {output.assignments
                                                            .filter(a => a.evaluator['Faculty Name'] !== evaluatorAssig.evaluator['Faculty Name'])
                                                            .map(a => (
                                                                <option key={a.evaluator['Faculty Name']} value={a.evaluator['Faculty Name']}>
                                                                    to {a.evaluator['Faculty Name']}
                                                                </option>
                                                            ))}
                                                        </select>
                                                </div>
                                                {(timedVat.suggestedMeetingUtcLabel || timedVat.evaluatorLocalSlot || timedVat.vatMemberLocalRange || timedVat.timingQuality) && (
                                                    <div style={{ marginTop: '0.75rem', padding: '0.65rem', background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: '0.5rem', display: 'grid', gap: '0.35rem' }}>
                                                        {timedVat.suggestedMeetingUtcLabel && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>Suggested session time:</strong> {timedVat.suggestedMeetingUtcLabel}
                                                            </div>
                                                        )}
                                                        {!timedVat.suggestedMeetingUtcLabel && timedVat.suggestedUtcSlot && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>Suggested UTC slot:</strong> {timedVat.suggestedUtcSlot}
                                                            </div>
                                                        )}
                                                        {(timedVat.suggestedDay || timedVat.suggestedDateUtc) && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>Suggested day:</strong> {[timedVat.suggestedDay, timedVat.suggestedDateUtc].filter(Boolean).join(' — ')}
                                                            </div>
                                                        )}
                                                        {timedVat.evaluatorLocalSlot && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>Evaluator local slot:</strong> {timedVat.evaluatorLocalSlot}
                                                            </div>
                                                        )}
                                                        {timedVat.vatMemberLocalRange && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>VAT member local range:</strong> {timedVat.vatMemberLocalRange}
                                                            </div>
                                                        )}
                                                        {timedVat.vatAvgLocalStart && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>VAT average local start:</strong> {timedVat.vatAvgLocalStart}
                                                            </div>
                                                        )}
                                                        {timedVat.timingQuality && (
                                                            <div style={{ fontSize: '0.75rem', color: '#166534' }}>
                                                                <strong>Timing quality:</strong> {timedVat.timingQuality}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {v.members && v.members.length > 0 && (
                                                    <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                        {v.members.map((m, mIdx) => {
                                                            const program = m.Program || m.Role || m['(AA) Secondary Specialization'] || 'Unknown Program';
                                                            const country = m.Country || 'Unknown Country';
                                                            return (
                                                                <div key={mIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '0.75rem' }}>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, paddingRight: '0.5rem' }}>
                                                                        <span style={{ fontWeight: 600, color: '#334155' }}>
                                                                            {m['Full Name'] || 'Unknown Name'}
                                                                        </span>
                                                                        <span style={{ color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={program}>
                                                                            {program}
                                                                        </span>
                                                                    </div>
                                                                    <div style={{ color: '#64748b', textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                                                        {country}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
