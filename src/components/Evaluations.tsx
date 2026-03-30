import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Users, AlertTriangle, Calendar as CalendarIcon } from 'lucide-react';
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

export function Evaluations({ records, facultyAssignments, output, onOutputChange }: EvaluationsProps) {
    const evaluators = evaluatorsData as EvaluatorRecord[];
    const [evalDate, setEvalDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [includeRAD, setIncludeRAD] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const hasAutoRun = useRef(false);

    const handleRunAssignment = useCallback(() => {
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

    const handleDownloadJson = () => {
        if (!output) return;
        
        // Format for export
        const exportData = {
            evaluationDate: evalDate,
            includeRAD: includeRAD,
            assignments: output.assignments.map(a => ({
                evaluatorName: a.evaluator['Faculty Name'],
                sa: a.sa,
                utcOffset: a.utcOffset,
                vatsAssigned: a.assignedVats.map(v => ({
                    vatName: v.name,
                    vatSa: v.sa,
                    vatAverageUtcOffset: v.utcOffset,
                    membersCount: v.members.length
                }))
            })),
            unassignedVats: output.unassignedVats.map(v => ({
                vatName: v.name,
                sa: v.sa,
                averageUtcOffset: v.utcOffset,
                membersCount: v.members.length
            }))
        };

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
                        <button onClick={handleDownloadJson} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Download size={16} /> Download JSON
                        </button>
                    </div>

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
