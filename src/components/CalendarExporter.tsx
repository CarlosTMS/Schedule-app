import { useState } from 'react';
import { Calendar, Eye } from 'lucide-react';

interface CalendarExporterProps {
    uniqueSchedules: string[]; // e.g. ["BTP Session 1 (8:00 UTC)", ...]
    sessionLength: number;
}

export function CalendarExporter({ uniqueSchedules, sessionLength }: CalendarExporterProps) {
    const [isOpen, setIsOpen] = useState(false);

    // Default start date to next Monday
    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + (1 + 7 - nextMonday.getDay()) % 7);
    if (nextMonday.getDay() === 0) nextMonday.setDate(nextMonday.getDate() + 1);

    const [startDate, setStartDate] = useState(nextMonday.toISOString().split('T')[0]);

    // Default end date 4 weeks later
    const fourWeeksLater = new Date(nextMonday);
    fourWeeksLater.setDate(fourWeeksLater.getDate() + 28);
    const [endDate, setEndDate] = useState(fourWeeksLater.toISOString().split('T')[0]);

    const [excludeWeekends, setExcludeWeekends] = useState(true);
    const [addDebrief, setAddDebrief] = useState(false);
    const [debriefDuration, setDebriefDuration] = useState(30);
    const [debriefDelay, setDebriefDelay] = useState(15);
    const [showVisual, setShowVisual] = useState(false);

    const generateVisual = () => {
        setShowVisual(true);
    };

    if (!isOpen) {
        return (
            <button
                className="btn btn-outline"
                onClick={() => setIsOpen(true)}
                style={{ padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: 'var(--border-radius-sm)', backgroundColor: 'white' }}
            >
                <Calendar size={18} />
                Visual Calendar
            </button>
        );
    }

    // --- VISUAL GRID LOGIC ---
    let allEvents: { id: string, title: string, startMins: number, duration: number, type: string, group: string, col?: number, totalCols?: number }[] = [];
    if (showVisual) {
        const baseEvents = uniqueSchedules.map(scheduleStr => {
            const match = scheduleStr.match(/(.+) Session (\d+) \((\d+):00 UTC\)/);
            if (!match) return null;
            const sa = match[1];
            const num = match[2];
            const startMins = parseInt(match[3], 10) * 60;
            return { id: scheduleStr, title: `${sa} S${num}`, startMins, duration: sessionLength, type: 'session', group: sa };
        }).filter((ev): ev is NonNullable<typeof ev> => Boolean(ev));

        allEvents = [...baseEvents];

        if (addDebrief) {
            baseEvents.forEach(ev => {
                if (!ev) return;
                const dStart = ev.startMins + ev.duration + debriefDelay;
                allEvents.push({
                    id: `${ev.id}-debrief`,
                    title: `${ev.title} Debrief`,
                    startMins: dStart,
                    duration: debriefDuration,
                    type: 'debrief',
                    group: ev.group
                });
            });
        }

        // naive layout
        allEvents.sort((a, b) => a.startMins - b.startMins || b.duration - a.duration);
        const columns: typeof allEvents[] = [];
        allEvents.forEach(ev => {
            let placed = false;
            for (let i = 0; i < columns.length; i++) {
                const lastEvInCol = columns[i][columns[i].length - 1];
                if (lastEvInCol.startMins + lastEvInCol.duration <= ev.startMins) {
                    columns[i].push(ev);
                    ev.col = i;
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                ev.col = columns.length;
                columns.push([ev]);
            }
        });

        allEvents.forEach(ev => {
            ev.totalCols = Math.max(1, columns.length);
        });
    }

    let minMins = 24 * 60;
    let maxMins = 0;
    allEvents.forEach(e => {
        if (e.startMins < minMins) minMins = e.startMins;
        if (e.startMins + e.duration > maxMins) maxMins = e.startMins + e.duration;
    });

    if (minMins > maxMins) {
        minMins = 8 * 60;
        maxMins = 18 * 60;
    }

    const startHour = Math.max(0, Math.floor(minMins / 60) - 1);
    const endHour = Math.min(24, Math.ceil(maxMins / 60) + 1);
    const numHours = endHour - startHour;
    const hourHeight = 60;

    const days = excludeWeekends ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];


    return (
        <div style={{ background: 'var(--glass-bg)', borderRadius: 'var(--border-radius-md)', padding: '1.5rem', border: 'var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Calendar size={18} /> Schedule Calendar
                </h4>
                <button className="btn btn-outline" onClick={() => { setIsOpen(false); setShowVisual(false); }} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>Close</button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Start Date</label>
                    <input type="date" className="input-field" value={startDate} onChange={e => { setStartDate(e.target.value); setShowVisual(false); }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>End Date</label>
                    <input type="date" className="input-field" value={endDate} onChange={e => { setEndDate(e.target.value); setShowVisual(false); }} />
                </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={excludeWeekends} onChange={e => { setExcludeWeekends(e.target.checked); setShowVisual(false); }} />
                Exclude Weekends (Sat / Sun)
            </label>

            <div style={{ borderTop: '1px solid #e2e8f0', margin: '0.5rem 0' }}></div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600 }}>
                <input type="checkbox" checked={addDebrief} onChange={e => { setAddDebrief(e.target.checked); setShowVisual(false); }} />
                Include Faculty Debrief Sessions
            </label>

            {addDebrief && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', paddingLeft: '1.5rem', borderLeft: '2px solid #cbd5e1' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Debrief Duration (mins)</label>
                        <select className="input-field" value={debriefDuration} onChange={e => { setDebriefDuration(parseInt(e.target.value, 10)); setShowVisual(false); }}>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Buffer time after session (mins)</label>
                        <select className="input-field" value={debriefDelay} onChange={e => { setDebriefDelay(parseInt(e.target.value, 10)); setShowVisual(false); }}>
                            <option value={0}>0 (Immediate)</option>
                            <option value={15}>15</option>
                            <option value={30}>30</option>
                            <option value={45}>45</option>
                            <option value={60}>60</option>
                        </select>
                    </div>
                </div>
            )}

            {!showVisual && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                    <button
                        className="btn btn-primary"
                        onClick={generateVisual}
                        style={{ padding: '0.6rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: 'var(--border-radius-sm)' }}
                    >
                        <Eye size={18} />
                        Generate Visual Weekly Calendar
                    </button>
                </div>
            )}

            {showVisual && (
                <div className="animated-fade-in" style={{ marginTop: '1rem', overflowX: 'auto', background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                    <h4 style={{ margin: '0 0 1rem 0' }}>Weekly Recurring Schedule Preview (UTC Time)</h4>
                    <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        This weekly pattern repeats from {startDate} to {endDate}.
                    </p>
                    <div style={{ display: 'flex', minWidth: '800px', borderTop: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0' }}>
                        <div style={{ width: '60px', flexShrink: 0, position: 'relative', background: '#f8fafc' }}>
                            {Array.from({ length: numHours }).map((_, i) => (
                                <div key={i} style={{ height: `${hourHeight}px`, borderBottom: '1px solid #e2e8f0', position: 'relative' }}>
                                    <span style={{ position: 'absolute', top: '-10px', right: '10px', fontSize: '10px', color: '#64748b' }}>
                                        {(startHour + i).toString().padStart(2, '0')}:00
                                    </span>
                                </div>
                            ))}
                        </div>

                        {days.map(day => (
                            <div key={day} style={{ flex: 1, borderRight: '1px solid #e2e8f0', position: 'relative' }}>
                                <div style={{ height: '30px', borderBottom: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 600, fontSize: '12px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>
                                    {day}
                                </div>
                                <div style={{ position: 'relative', height: `${numHours * hourHeight}px` }}>
                                    {/* background grid lines */}
                                    {Array.from({ length: numHours }).map((_, i) => (
                                        <div key={i} style={{ height: `${hourHeight}px`, borderBottom: '1px solid #f1f5f9', width: '100%', position: 'absolute', top: `${i * hourHeight}px`, zIndex: 0 }}></div>
                                    ))}

                                    {/* events */}
                                    {allEvents.map((ev, idx) => {
                                        const top = ((ev.startMins - (startHour * 60)) / 60) * hourHeight;
                                        const height = (ev.duration / 60) * hourHeight;
                                        const isDebrief = ev.type === 'debrief';

                                        const widthPercent = 96 / (ev.totalCols || 1);
                                        const leftPercent = 2 + ((ev.col || 0) * widthPercent);

                                        return (
                                            <div key={`${ev.id}-${idx}`} style={{
                                                position: 'absolute',
                                                top: `${top}px`,
                                                height: `${height}px`,
                                                left: `${leftPercent}%`,
                                                width: `calc(${widthPercent}% - 2px)`,
                                                background: isDebrief ? '#fef08a' : '#bae6fd',
                                                border: `1px solid ${isDebrief ? '#eab308' : '#38bdf8'}`,
                                                borderRadius: '4px',
                                                padding: '2px 4px',
                                                fontSize: '10px',
                                                overflow: 'hidden',
                                                color: '#0f172a',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                zIndex: 10,
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                            }}>
                                                <span style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ev.title}</span>
                                                <span style={{ fontSize: '9px', opacity: 0.8 }}>
                                                    {Math.floor(ev.startMins / 60)}:{(ev.startMins % 60).toString().padStart(2, '0')} - {Math.floor((ev.startMins + ev.duration) / 60)}:{((ev.startMins + ev.duration) % 60).toString().padStart(2, '0')}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
