import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import type { StudentRecord } from '../lib/excelParser';
import type { SmeAssignments } from './SMESchedule';
import type { FacultyAssignments } from './FacultySchedule';
import type { SME } from '../lib/smeMatcher';
import type { SMECacheStatus } from '../lib/smeDataLoader';
import { useI18n } from '../i18n';
import {
  buildComparableAppRows,
  compareAgainstAirtable,
  type AirtableCheckResult,
  type AirtableRow,
} from '../lib/airtableCheck';

interface AirtableCheckProps {
  records: StudentRecord[];
  schedulesBySA: Record<string, Set<string>>;
  startHour: number;
  endHour: number;
  facultyStartHour?: number;
  sessionTimeOverrides: Record<string, number>;
  sessionInstanceTimeOverrides: Record<string, number>;
  manualSmeAssignments: SmeAssignments;
  manualFacultyAssignments: FacultyAssignments;
  smeList: SME[];
  smeStatus: SMECacheStatus | null;
}

interface AirtableCheckApiResponse {
  ok: boolean;
  fetchedAt: string;
  sourceUrl: string;
  rows: AirtableRow[];
}

export function AirtableCheck(props: AirtableCheckProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [airtableRows, setAirtableRows] = useState<AirtableRow[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  const appRows = useMemo(
    () => buildComparableAppRows(props),
    [props]
  );

  const comparison: AirtableCheckResult = useMemo(
    () => compareAgainstAirtable(appRows, airtableRows),
    [appRows, airtableRows]
  );

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/airtable-check');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AirtableCheckApiResponse;
      setAirtableRows(data.rows ?? []);
      setFetchedAt(data.fetchedAt ?? null);
      setSourceUrl(data.sourceUrl ?? null);
    } catch (err) {
      setError(String(err));
      setAirtableRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runCheck();
  }, []);

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>{t('airtableCheckTitle')}</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {t('airtableCheckDesc')}
            </p>
            {fetchedAt && (
              <div style={{ marginTop: '0.55rem', fontSize: '0.78rem', color: '#64748b' }}>
                {t('lastUpdatedLabel')}: <strong>{new Date(fetchedAt).toLocaleString()}</strong>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {sourceUrl && (
              <a href={sourceUrl} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ gap: '0.45rem' }}>
                <ExternalLink size={14} /> Airtable
              </a>
            )}
            <button onClick={() => { void runCheck(); }} className="btn btn-primary" style={{ gap: '0.45rem' }} disabled={loading}>
              <RefreshCw size={14} /> {loading ? t('processingData') : t('versionRefreshLatest')}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.35rem' }}>{t('airtableCheckMatched')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{comparison.matched.length}</div>
        </div>
        <div className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.35rem' }}>{t('airtableCheckDifferences')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{comparison.matched.filter((row) => row.differences.length > 0).length}</div>
        </div>
        <div className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.35rem' }}>{t('airtableCheckOnlyApp')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{comparison.onlyInApp.length}</div>
        </div>
        <div className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.35rem' }}>{t('airtableCheckOnlyAirtable')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{comparison.onlyInAirtable.length}</div>
        </div>
      </div>

      {error && (
        <div className="glass-panel" style={{ padding: '1rem 1.2rem', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <AlertTriangle size={16} />
            <strong>{t('airtableCheckError')}</strong>
          </div>
          <div style={{ marginTop: '0.45rem', fontSize: '0.86rem' }}>{error}</div>
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h4 style={{ margin: '0 0 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={16} /> {t('airtableCheckDifferences')}
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {comparison.matched.filter((row) => row.differences.length > 0).length === 0 && !loading && (
            <div style={{ color: '#166534', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} /> {t('airtableCheckNoDifferences')}
            </div>
          )}
          {comparison.matched
            .filter((row) => row.differences.length > 0)
            .map((row) => (
              <div key={`${row.app.sessionName}-${row.airtable.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.app.sessionName}</div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: '#64748b' }}>
                  Match score: {Math.round(row.score)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.8rem' }}>
                  {row.differences.map((difference) => (
                    <div key={`${row.airtable.id}-${difference.field}`} style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{difference.label}</div>
                      <div style={{ fontSize: '0.8rem', color: '#334155' }}>
                        <strong>{t('airtableCheckAppValue')}:</strong> {difference.appValue || '—'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#334155', marginTop: '0.2rem' }}>
                        <strong>{t('airtableCheckAirtableValue')}:</strong> {difference.airtableValue || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.85rem' }}>{t('airtableCheckOnlyApp')}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {comparison.onlyInApp.length === 0 && !loading && <div style={{ color: '#64748b' }}>{t('airtableCheckNoOnlyApp')}</div>}
            {comparison.onlyInApp.slice(0, 50).map((row) => (
              <div key={`${row.sessionName}-${row.calendarStartIso}`} style={{ padding: '0.7rem 0.85rem', borderRadius: '10px', background: '#f8fafc' }}>
                <div style={{ fontWeight: 600 }}>{row.sessionName}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>{row.calendarStartIso}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h4 style={{ margin: '0 0 0.85rem' }}>{t('airtableCheckOnlyAirtable')}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {comparison.onlyInAirtable.length === 0 && !loading && <div style={{ color: '#64748b' }}>{t('airtableCheckNoOnlyAirtable')}</div>}
            {comparison.onlyInAirtable.slice(0, 50).map((row) => (
              <div key={row.id} style={{ padding: '0.7rem 0.85rem', borderRadius: '10px', background: '#f8fafc' }}>
                <div style={{ fontWeight: 600 }}>{row.sessionName}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>{row.calendarStartIso}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
