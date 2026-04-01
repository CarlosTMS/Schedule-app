import { useCallback, useState, useMemo, useEffect, useRef } from 'react';

import './index.css';
import { FileUpload } from './components/FileUpload';
import { Configurator } from './components/Configurator';
import type { Assumptions } from './components/Configurator';
import { RuleBuilder } from './components/RuleBuilder';
import type { AllocationRule } from './components/RuleBuilder';
import { Randomizer } from './components/Randomizer';
import type { DistributionTarget } from './components/Randomizer';
import { Dashboard } from './components/Dashboard';
import { parseExcel } from './lib/excelParser';
import { parseSummaryJson, parseEnrichedExcel } from './lib/jsonParser';
import type { StudentRecord } from './lib/excelParser';
import { runAllocation } from './lib/allocationEngine';
import type { AllocationResult } from './lib/allocationEngine';
import { repository, type EditorIdentity, type PublicApiStatus, type SyncStatus, type VersionPresence } from './lib/runHistoryRepository';
import { type RunProject, type RunVersion, type RunSnapshot } from './lib/runHistoryStorage';
import type { SmeAssignments, SmeConfirmationState } from './components/SMESchedule';
import type { FacultyAssignments } from './components/FacultySchedule';
import type { EvaluationEngineOutput } from './lib/evaluationEngine';
import { useI18n } from './i18n';
import { Globe, Clock, Trash2, RotateCcw, Pencil, CheckCircle2, Plus, History, Save, Loader2, ShieldAlert, ChevronLeft, ChevronRight, Link2, RefreshCw, GitBranch } from 'lucide-react';
import { forceFetchSMEData, loadSMEData, type SMECacheStatus } from './lib/smeDataLoader';
import type { SME } from './lib/smeMatcher';
import { buildSchedulesBySA, buildSummaryExport, buildVatsExport } from './lib/publicApiPayloads';
import { applyConflictResolutions, formatRelativeTimestamp, getEditorIdentity, hasEditorIdentityName, mergeSnapshots, setEditorIdentityName, type MergeConflict } from './lib/collaboration';

export interface ApiSnapshotEndpoints {
  publicSummaryUrl: string | null;
  publicVatsUrl: string | null;
  versionSummaryUrl: string | null;
  versionVatsUrl: string | null;
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const { t, lang, toggleLang } = useI18n();
  const SIDEBAR_COLLAPSED_KEY = 'scheduler_sidebar_collapsed_v1';

  // ── Core data state (Current Working Draft) ────────────────────────────────
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [previousMetrics, setPreviousMetrics] = useState<AllocationResult['metrics'] | null>(null);

  // ── Config state ───────────────────────────────────────────────────────────
  const [startHour, setStartHour] = useState<number>(8);
  const [endHour, setEndHour] = useState<number>(18);
  const [assumptions, setAssumptions] = useState<Assumptions>({
    minSessionSize: 10,
    maxSessionSize: 40,
    maxSessionsPerDay: 2,
    allowedVATSizes: [3, 4],
    sessionLength: 90,
    maxTimezoneDifference: 5,
    allowSingleRoleVat: false,
    facultyStartHour: 6,
  });
  const [rules, setRules] = useState<AllocationRule[]>([]);
  const [fsDistributions, setFsDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 50 },
    { sa: 'oCFO', percentage: 50 },
  ]);
  const [aeDistributions, setAeDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 25 },
    { sa: 'Data & AI', percentage: 25 },
    { sa: 'BTP', percentage: 25 },
    { sa: 'oCFO', percentage: 25 },
  ]);

  // ── Dashboard live editing state ──────────────────────────────────────────
  const [dashboardRecords, setDashboardRecords] = useState<StudentRecord[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<AllocationResult['metrics'] | null>(null);
  const [sessionTimeOverrides, setSessionTimeOverrides] = useState<Record<string, number>>({});
  const [sessionInstanceTimeOverrides, setSessionInstanceTimeOverrides] = useState<Record<string, number>>({});
  const [manualSmeAssignments, setManualSmeAssignments] = useState<SmeAssignments>({});
  const [smeConfirmationState, setSmeConfirmationState] = useState<SmeConfirmationState>({});
  const [manualFacultyAssignments, setManualFacultyAssignments] = useState<FacultyAssignments>({});
  const [evaluationsOutput, setEvaluationsOutput] = useState<EvaluationEngineOutput | null>(null);

  // ── Persistence / Versioning state ─────────────────────────────────────────
  const [projects, setProjects] = useState<RunProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectVersions, setProjectVersions] = useState<RunVersion[]>([]);
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
  const [publicApiStatus, setPublicApiStatus] = useState<PublicApiStatus | null>(null);
  const [editorIdentity, setEditorIdentity] = useState<EditorIdentity>(() => getEditorIdentity());
  const [pendingEditorName, setPendingEditorName] = useState('');
  const [dismissedLatestVersionPromptFor, setDismissedLatestVersionPromptFor] = useState<string | null>(null);
  const [remoteChangesAvailable, setRemoteChangesAvailable] = useState(false);
  const [remoteVersionUpdate, setRemoteVersionUpdate] = useState<RunVersion | null>(null);
  const [presence, setPresence] = useState<VersionPresence[]>([]);
  const [conflictState, setConflictState] = useState<{
    remoteVersion: RunVersion | null;
    expectedRevision: number | null;
    mergedSnapshot: RunSnapshot;
    conflicts: MergeConflict[];
    resolutions: Record<string, 'local' | 'remote'>;
    autoMergedCount: number;
  } | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [autosaveStatus, setAutosaveStatus] = useState<SyncStatus>('idle');
  const [smeList, setSmeList] = useState<SME[]>([]);
  const [smeStatus, setSmeStatus] = useState<SMECacheStatus | null>(null);

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRevisionRef = useRef<Record<string, number>>({});
  const loadedBaseSnapshotRef = useRef<RunSnapshot | null>(null);
  const loadedBaseRevisionRef = useRef<number | null>(null);

  // Sync refs with state
  useEffect(() => {
    projectRevisionRef.current = projects.reduce<Record<string, number>>((acc, project) => {
      if (project.revision !== undefined) acc[project.id] = project.revision;
      return acc;
    }, {});
  }, [projects]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isSidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore storage write errors.
    }
  }, [isSidebarCollapsed, SIDEBAR_COLLAPSED_KEY]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const currentSnapshot = useMemo((): RunSnapshot => ({
    records, assumptions, rules, fsDistributions, aeDistributions, startHour, endHour,
    result: (result && dashboardMetrics) ? { ...result, records: dashboardRecords, metrics: dashboardMetrics } : result as AllocationResult,
    sessionTimeOverrides, sessionInstanceTimeOverrides, manualSmeAssignments, smeConfirmationState, manualFacultyAssignments, evaluationsOutput
  }), [records, assumptions, rules, fsDistributions, aeDistributions, startHour, endHour, result, dashboardRecords, dashboardMetrics, sessionTimeOverrides, sessionInstanceTimeOverrides, manualSmeAssignments, smeConfirmationState, manualFacultyAssignments, evaluationsOutput]);

  const publicSourceVersionId = useMemo(
    () => projects.find((project) => project.publicApiVersionId)?.publicApiVersionId ?? null,
    [projects]
  );
  const editorReady = useMemo(() => hasEditorIdentityName(editorIdentity), [editorIdentity]);
  const loadedVersion = useMemo(
    () => projectVersions.find(version => version.id === loadedVersionId) ?? null,
    [projectVersions, loadedVersionId]
  );

  const applySnapshot = useCallback((s: RunSnapshot) => {
    setRecords(s.records);
    setDashboardRecords(s.records);
    setAssumptions(s.assumptions);
    setRules(s.rules);
    setFsDistributions(s.fsDistributions);
    setAeDistributions(s.aeDistributions);
    setStartHour(s.startHour);
    setEndHour(s.endHour);
    setResult(s.result);
    setDashboardMetrics(s.result?.metrics || null);
    setSessionTimeOverrides(s.sessionTimeOverrides);
    setSessionInstanceTimeOverrides(s.sessionInstanceTimeOverrides ?? {});
    setManualSmeAssignments(s.manualSmeAssignments);
    setSmeConfirmationState(s.smeConfirmationState ?? {});
    setManualFacultyAssignments(s.manualFacultyAssignments);
    setEvaluationsOutput(s.evaluationsOutput ?? null);
    setPreviousMetrics(null);
  }, []);

  const loadProjectSnapshot = useCallback(async (projectId: string, fallbackVersionId?: string | null) => {
    if (fallbackVersionId) {
      const version = await repository.getVersion(fallbackVersionId, { forceRemote: true });
      if (version) {
        applySnapshot(version.snapshot);
        setActiveProjectId(projectId);
        setLoadedVersionId(version.id);
        setRemoteVersionUpdate(version);
        loadedBaseSnapshotRef.current = JSON.parse(JSON.stringify(version.snapshot));
        const project = await repository.getProject(projectId);
        loadedBaseRevisionRef.current = project?.revision ?? null;
        setRemoteChangesAvailable(false);
        return;
      }
    }

    setActiveProjectId(projectId);
    setLoadedVersionId(null);
    setRemoteVersionUpdate(null);
  }, [applySnapshot]);

  const refreshPublicApiStatus = useCallback(async () => {
    const status = await repository.getPublicApiStatus();
    setPublicApiStatus(status);
  }, []);

  const refreshSmes = useCallback(async () => {
    const { smes, status } = await forceFetchSMEData();
    setSmeList(smes);
    setSmeStatus(status);
  }, []);

  const handleRenameEditor = () => {
    const nextName = window.prompt(t('editorNamePrompt'), editorIdentity.name);
    if (nextName === null) return;
    if (!nextName.trim()) {
      setError(t('editorNameRequired'));
      return;
    }
    setEditorIdentity(setEditorIdentityName(nextName));
  };

  const handleCompleteEditorSetup = () => {
    if (!pendingEditorName.trim()) {
      setError(t('editorNameRequired'));
      return;
    }
    setEditorIdentity(setEditorIdentityName(pendingEditorName));
    setPendingEditorName('');
    setError(null);
  };

  const publishVersionOutputs = useCallback(async (projectId: string, versionId: string, snapshot: RunSnapshot) => {
    if (!snapshot.result) return;

    let effectiveSmeList = smeList;
    let effectiveSmeStatus = smeStatus;
    if (effectiveSmeList.length === 0) {
      const loaded = await loadSMEData();
      effectiveSmeList = loaded.smes;
      effectiveSmeStatus = loaded.status;
      setSmeList(loaded.smes);
      setSmeStatus(loaded.status);
    }

    const exportRecords = snapshot.result?.records?.length ? snapshot.result.records : snapshot.records;
    const exportSchedulesBySA = buildSchedulesBySA(exportRecords);

    const summaryPayload = buildSummaryExport({
      records: exportRecords,
      schedulesBySA: exportSchedulesBySA,
      startHour: snapshot.startHour,
      endHour: snapshot.endHour,
      facultyStartHour: snapshot.assumptions.facultyStartHour ?? 6,
      sessionTimeOverrides: snapshot.sessionTimeOverrides,
      sessionInstanceTimeOverrides: snapshot.sessionInstanceTimeOverrides,
      manualSmeAssignments: snapshot.manualSmeAssignments,
      manualFacultyAssignments: snapshot.manualFacultyAssignments,
      smeList: effectiveSmeList,
      smeStatus: effectiveSmeStatus,
    });
    const vatsPayload = buildVatsExport(exportRecords);

    const base = `/api/public/projects/${projectId}/versions/${versionId}`;
    const [summaryRes, vatsRes] = await Promise.all([
      fetch(`${base}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(summaryPayload),
      }),
      fetch(`${base}/vats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vatsPayload),
      }),
    ]);

    if (!summaryRes.ok || !vatsRes.ok) {
      throw new Error(`Failed to publish versioned APIs (${summaryRes.status}/${vatsRes.status})`);
    }

    await refreshPublicApiStatus();
  }, [
    smeList,
    smeStatus,
    refreshPublicApiStatus,
  ]);

  const getApiSnapshotEndpoints = useCallback((projectId?: string | null, versionId?: string | null): ApiSnapshotEndpoints => {
    const isPublicSource = Boolean(versionId && versionId === publicSourceVersionId);
    return {
      publicSummaryUrl: isPublicSource ? `${window.location.origin}/api/public/summary` : null,
      publicVatsUrl: isPublicSource ? `${window.location.origin}/api/public/vats` : null,
      versionSummaryUrl: projectId && versionId ? `${window.location.origin}/api/public/projects/${projectId}/versions/${versionId}/summary` : null,
      versionVatsUrl: projectId && versionId ? `${window.location.origin}/api/public/projects/${projectId}/versions/${versionId}/vats` : null,
    };
  }, [publicSourceVersionId]);

  const handleRefreshApiSnapshots = useCallback(async (): Promise<ApiSnapshotEndpoints | null> => {
    if (!activeProjectId || !loadedVersionId || !currentSnapshot.result) {
      setError('Save or load a version before refreshing API snapshots.');
      return null;
    }
    await publishVersionOutputs(activeProjectId, loadedVersionId, currentSnapshot);
    return getApiSnapshotEndpoints(activeProjectId, loadedVersionId);
  }, [activeProjectId, loadedVersionId, currentSnapshot, publishVersionOutputs, getApiSnapshotEndpoints]);

  const openMergeConflict = useCallback((remoteVersion: RunVersion | null, expectedRevision: number | null) => {
    if (!remoteVersion || !loadedBaseSnapshotRef.current) return;
    const merge = mergeSnapshots(loadedBaseSnapshotRef.current, currentSnapshot, remoteVersion.snapshot);
    const defaultResolutions = Object.fromEntries(merge.conflicts.map(conflict => [conflict.id, 'local'])) as Record<string, 'local' | 'remote'>;
    setConflictState({
      remoteVersion,
      expectedRevision,
      mergedSnapshot: merge.mergedSnapshot,
      conflicts: merge.conflicts,
      resolutions: defaultResolutions,
      autoMergedCount: merge.autoMergedCount,
    });
  }, [currentSnapshot]);

  const finalizeVersionSave = useCallback(async (versionId: string, snapshot: RunSnapshot, expectedRevision: number | undefined) => {
    const { version, project, status, conflict } = await repository.updateVersion(versionId, snapshot, {
      expectedRevision,
      editor: editorIdentity,
    });

    if (status === 'conflict') {
      setAutosaveStatus('conflict');
      if (conflict?.version) {
        openMergeConflict(conflict.version, conflict.project?.revision ?? null);
      }
      if (conflict?.project) {
        setProjects(prev => prev.map(existing => existing.id === conflict.project.id ? conflict.project : existing));
      }
      return { saved: false, status };
    }

    setAutosaveStatus(status);
    if (version) {
      setProjectVersions(prev => prev.map(v => v.id === version.id ? version : v));
      loadedBaseSnapshotRef.current = JSON.parse(JSON.stringify(version.snapshot));
      setRemoteVersionUpdate(version);
    }
    if (project) {
      if (project.revision !== undefined) {
        projectRevisionRef.current[project.id] = project.revision;
        loadedBaseRevisionRef.current = project.revision;
      }
      setProjects(prev => prev.map(p => p.id === project.id ? project : p));
      setRemoteChangesAvailable(false);
    }

    if (version) {
      await publishVersionOutputs(activeProjectId!, version.id, snapshot);
    }

    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setAutosaveStatus('idle'), 3000);
    return { saved: true, status };
  }, [activeProjectId, editorIdentity, openMergeConflict, publishVersionOutputs]);

  const handleReviewRemoteChanges = async () => {
    if (!loadedVersionId) return;
    const remoteVersion = await repository.getVersion(loadedVersionId, { forceRemote: true });
    const remoteProject = activeProjectId ? await repository.getProject(activeProjectId) : null;
    if (remoteVersion) {
      openMergeConflict(remoteVersion, remoteProject?.revision ?? null);
    }
  };

  const handleReloadLatestVersion = async () => {
    if (!loadedVersionId || !activeProjectId) return;
    const remoteVersion = await repository.getVersion(loadedVersionId, { forceRemote: true });
    if (!remoteVersion) return;
    applySnapshot(remoteVersion.snapshot);
    setProjectVersions(prev => prev.map(version => version.id === remoteVersion.id ? remoteVersion : version));
    loadedBaseSnapshotRef.current = JSON.parse(JSON.stringify(remoteVersion.snapshot));
    const project = await repository.getProject(activeProjectId);
    loadedBaseRevisionRef.current = project?.revision ?? null;
    setRemoteChangesAvailable(false);
    setRemoteVersionUpdate(remoteVersion);
    setConflictState(null);
  };

  const handleSaveMergedConflict = async () => {
    if (!loadedVersionId || !conflictState) return;
    setLoading(true);
    try {
      const resolvedSnapshot = applyConflictResolutions(
        conflictState.mergedSnapshot,
        conflictState.conflicts,
        conflictState.resolutions
      );
      applySnapshot(resolvedSnapshot);
      await finalizeVersionSave(loadedVersionId, resolvedSnapshot, conflictState.expectedRevision ?? loadedBaseRevisionRef.current ?? undefined);
      setConflictState(null);
    } catch (err) {
      setError(t('publicApiPublishFailed').replace('{err}', String(err)));
    } finally {
      setLoading(false);
    }
  };

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const [{ smes, status }, { projects: projs, activeProjectId: lastPid }] = await Promise.all([
        loadSMEData(),
        repository.getSyncData(),
      ]);
      setSmeList(smes);
      setSmeStatus(status);
      await refreshPublicApiStatus();
      setProjects(projs);
      if (lastPid) {
        const p = projs.find(x => x.id === lastPid);
        if (p) {
          await loadProjectSnapshot(p.id, p.activeVersionId);
        }
      }
    };
    init();
  }, [applySnapshot, loadProjectSnapshot, refreshPublicApiStatus]);

  // Update versions when active project changes
  useEffect(() => {
    if (activeProjectId) {
      repository.getVersions(activeProjectId).then(setProjectVersions);
    } else {
      setProjectVersions([]);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || !loadedVersionId || !editorReady) {
      setPresence([]);
      setRemoteVersionUpdate(null);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const [activePresence, remoteVersion] = await Promise.all([
        repository.getPresence(loadedVersionId),
        repository.getVersion(loadedVersionId, { forceRemote: true }),
      ]);
      if (cancelled) return;
      const hasNewerSameVersion = Boolean(
        remoteVersion &&
        loadedVersion &&
        new Date(remoteVersion.createdAt).getTime() > new Date(loadedVersion.createdAt).getTime()
      );
      setRemoteVersionUpdate(remoteVersion ?? null);
      setRemoteChangesAvailable(hasNewerSameVersion);
      setPresence(activePresence);
    };

    const heartbeat = async () => {
      await repository.touchPresence(loadedVersionId, editorIdentity);
      if (!cancelled) {
        const activePresence = await repository.getPresence(loadedVersionId);
        if (!cancelled) setPresence(activePresence);
      }
    };

    void refresh();
    void heartbeat();

    const refreshInterval = window.setInterval(() => { void refresh(); }, 20000);
    const heartbeatInterval = window.setInterval(() => { void heartbeat(); }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      window.clearInterval(heartbeatInterval);
    };
  }, [activeProjectId, loadedVersionId, editorIdentity, editorReady, loadedVersion]);

  // ── Autosave Draft (Local & Remote Sync) ───────────────────────────────────
  useEffect(() => {
    setAutosaveStatus('idle');
  }, [currentSnapshot]);



  const handleCreateProject = async () => {
    if (!editorReady) {
      setError(t('editorNameRequired'));
      return;
    }
    if (!result) return;
    const name = window.prompt(t('projectName'), `Project ${new Date().toLocaleDateString()}`);
    if (!name) return;

    setLoading(true);
    try {
      const { project, version } = await repository.createProject(name, { ...currentSnapshot }, editorIdentity);
      const publicSourceResult = await repository.setPublicApiSource(project.id, version.id);
      if (publicSourceResult.source) {
        project.publicApiVersionId = version.id;
      }
      await publishVersionOutputs(project.id, version.id, version.snapshot);
      setProjects(prev => [
        project,
        ...prev.map(existing => ({ ...existing, publicApiVersionId: null })),
      ]);
      setActiveProjectId(project.id);
      setProjectVersions([version]);
      setLoadedVersionId(version.id);
      setRemoteVersionUpdate(version);
      loadedBaseSnapshotRef.current = JSON.parse(JSON.stringify(version.snapshot));
      loadedBaseRevisionRef.current = project.revision ?? 1;
    } catch (err) {
      setError(t('publicApiProjectCreatePublishFailed').replace('{err}', String(err)));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveVersion = async () => {
    if (!editorReady) {
      setError(t('editorNameRequired'));
      return;
    }
    if (!activeProjectId || !result) return;
    const label = window.prompt(t('versionLabel')) || undefined;

    setLoading(true);
    try {
      const { version } = await repository.saveAsNewVersion(activeProjectId, currentSnapshot, label, editorIdentity);
      await publishVersionOutputs(activeProjectId, version.id, version.snapshot);
      setProjectVersions(prev => [version, ...prev]);
      setLoadedVersionId(version.id);
      setRemoteVersionUpdate(version);

      const { projects: updatedProjs } = await repository.getSyncData();
      setProjects(updatedProjs);
      loadedBaseSnapshotRef.current = JSON.parse(JSON.stringify(version.snapshot));
      loadedBaseRevisionRef.current = updatedProjs.find(project => project.id === activeProjectId)?.revision ?? null;
      setRemoteChangesAvailable(false);
    } catch (err) {
      setError(t('publicApiPublishFailed').replace('{err}', String(err)));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrentVersion = async () => {
    if (!editorReady) {
      setError(t('editorNameRequired'));
      return;
    }
    if (!activeProjectId || !result || !loadedVersionId) return;

    setLoading(true);
    setAutosaveStatus('saving');

    try {
      await finalizeVersionSave(loadedVersionId, currentSnapshot, loadedBaseRevisionRef.current ?? undefined);
    } catch (err) {
      setAutosaveStatus('error');
      setError(t('publicApiPublishFailed').replace('{err}', String(err)));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadVersion = async (v: RunVersion) => {
    applySnapshot(v.snapshot);
    setActiveProjectId(v.projectId);
    setLoadedVersionId(v.id);
    loadedBaseSnapshotRef.current = JSON.parse(JSON.stringify(v.snapshot));
    const project = await repository.getProject(v.projectId);
    loadedBaseRevisionRef.current = project?.revision ?? null;
    setRemoteChangesAvailable(false);
    setRemoteVersionUpdate(v);
  };

  const handleSetPublicApiSource = async (projectId: string, versionId: string) => {
    setLoading(true);
    const { source, status } = await repository.setPublicApiSource(projectId, versionId);
    if (status === 'error' || !source) {
      setError(t('publicApiSourceUpdateFailed'));
      setLoading(false);
      return;
    }

    setProjects(prev =>
      prev.map(project => ({
        ...project,
        publicApiVersionId: project.id === projectId ? versionId : null,
      }))
    );

    if (loadedVersionId === versionId && result) {
      try {
        await publishVersionOutputs(projectId, versionId, currentSnapshot);
      } catch (err) {
        setError(`Saved the public source selection, but failed to refresh APIs. ${String(err)}`);
      }
    } else {
      await refreshPublicApiStatus();
    }

    setLoading(false);
  };

  const handleDeleteVersion = async (version: RunVersion) => {
    if (!activeProjectId) return;
    if (!window.confirm(t('versionDeleteConfirm'))) return;

    const ok = await repository.deleteVersion(activeProjectId, version.id);
    if (!ok) {
      setError(t('versionDeleteFailed'));
      return;
    }

    const updatedVersions = await repository.getVersions(activeProjectId);
    setProjectVersions(updatedVersions);

    if (loadedVersionId === version.id) {
      setLoadedVersionId(null);
      setRemoteVersionUpdate(null);
    }

    const { projects: updatedProjs } = await repository.getSyncData();
    setProjects(updatedProjs);
  };

  const handleDeleteProject = async (id: string) => {
    if (!window.confirm(t('historyConfirmDelete'))) return;
    const ok = await repository.deleteProject(id);
    if (ok) {
      setProjects(prev => prev.filter(p => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
        setProjectVersions([]);
        setLoadedVersionId(null);
        setRemoteVersionUpdate(null);
      }
    } else {
      setError("Failed to delete project on server. Keep in mind that deletion is only supported while online.");
    }
  };

  const handleRenameProject = async (id: string) => {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    const newName = window.prompt(t('historyNewName'), p.name);
    if (newName) {
      const status = await repository.renameProject(id, newName);
      if (status === 'saved') {
        setProjects(prev => prev.map(x => x.id === id ? { ...x, name: newName } : x));
      } else {
        setError("Failed to rename project on server. Keep in mind that rename is only supported while online.");
      }
    }
  };

  const handleRun = () => {
    setLoading(true);
    setTimeout(async () => {
      try {
        const res = runAllocation(records, startHour, endHour, rules, fsDistributions, aeDistributions, assumptions);
        const mets = res.metrics;
        setResult(res);
        setDashboardRecords(res.records);
        setDashboardMetrics(mets);
        setSessionTimeOverrides({});
        setSmeConfirmationState({});
        setManualSmeAssignments({});
        setManualFacultyAssignments({});
        setEvaluationsOutput(null);
        setLoadedVersionId(null);
      } catch (e) {
        setError("Error during allocation engine execution.");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const handleFileSelect = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      if (file.name.endsWith('.json')) {
        const parsed = await parseSummaryJson(file);
        setRecords(parsed.records);
        setDashboardRecords(parsed.records);
        setManualSmeAssignments(parsed.manualSmeAssignments);
        setSmeConfirmationState(parsed.smeConfirmationState ?? {});
        setManualFacultyAssignments(parsed.manualFacultyAssignments);
        setSessionTimeOverrides(parsed.sessionTimeOverrides);
        setSessionInstanceTimeOverrides(parsed.sessionInstanceTimeOverrides ?? {});
        setEvaluationsOutput(parsed.evaluationsOutput ?? null);
        
        // Ensure result is set to bypass configurator
        setResult(parsed.fakeResult);
        setDashboardMetrics(parsed.fakeResult.metrics);
        
        setPreviousMetrics(null);
        setActiveProjectId(null);
        setLoadedVersionId(null);
      } else {
        const parsedEx = await parseExcel(file);
        
        // If the parsed Excel already has Schedule, treat it as an explicitly enriched return
        if (parsedEx.length > 0 && parsedEx.some(r => r.Schedule)) {
            const parsed = parseEnrichedExcel(parsedEx);
            setRecords(parsed.records);
            setDashboardRecords(parsed.records);
            setManualSmeAssignments(parsed.manualSmeAssignments);
            setSmeConfirmationState(parsed.smeConfirmationState ?? {});
            setManualFacultyAssignments(parsed.manualFacultyAssignments);
            setSessionTimeOverrides(parsed.sessionTimeOverrides);
            setSessionInstanceTimeOverrides(parsed.sessionInstanceTimeOverrides ?? {});
            setEvaluationsOutput(parsed.evaluationsOutput ?? null);
            
            // Bypass configurator
            setResult(parsed.fakeResult);
            setDashboardMetrics(parsed.fakeResult.metrics);
            
            setPreviousMetrics(null);
            setActiveProjectId(null);
            setLoadedVersionId(null);
        } else {
            setRecords(parsedEx);
            setDashboardRecords([]);
            setResult(null);
            setPreviousMetrics(null);
            setSessionTimeOverrides({});
            setSessionInstanceTimeOverrides({});
            setManualSmeAssignments({});
            setSmeConfirmationState({});
            setManualFacultyAssignments({});
            setEvaluationsOutput(null);
            setActiveProjectId(null);
            setLoadedVersionId(null);
        }
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to parse ${file.name.endsWith('.json') ? 'JSON' : 'Excel'} file. ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const uniqueValuesMap = useMemo(() => {
    const map: Record<string, string[]> = {
      'Country': [], 'Office': [], 'Solution Weeks SA': [], '(AA) Secondary Specialization': []
    };
    records.forEach(r => {
      if (r.Country && !map['Country'].includes(r.Country)) map['Country'].push(r.Country);
      if (r.Office && !map['Office'].includes(r.Office)) map['Office'].push(r.Office);
      if (r['Solution Weeks SA'] && !map['Solution Weeks SA'].includes(r['Solution Weeks SA'])) map['Solution Weeks SA'].push(r['Solution Weeks SA']);
      if (r['(AA) Secondary Specialization'] && !map['(AA) Secondary Specialization'].includes(r['(AA) Secondary Specialization'])) map['(AA) Secondary Specialization'].push(r['(AA) Secondary Specialization']);
    });
    return map;
  }, [records]);

  const isViewingLatestVersion = Boolean(
    loadedVersion &&
    (!remoteVersionUpdate || new Date(remoteVersionUpdate.createdAt).getTime() <= new Date(loadedVersion.createdAt).getTime())
  );
  const showLatestVersionPrompt = Boolean(
    loadedVersionId &&
    remoteVersionUpdate &&
    !isViewingLatestVersion &&
    dismissedLatestVersionPromptFor !== loadedVersionId
  );
  const otherEditors = presence.filter(item => item.editor.id !== editorIdentity.id);

  useEffect(() => {
    if (!loadedVersionId || isViewingLatestVersion) {
      setDismissedLatestVersionPromptFor(null);
      return;
    }
    if (dismissedLatestVersionPromptFor && dismissedLatestVersionPromptFor !== loadedVersionId) {
      setDismissedLatestVersionPromptFor(null);
    }
  }, [loadedVersionId, isViewingLatestVersion, dismissedLatestVersionPromptFor]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img src="/sessionzilla-mark.svg" alt="Sessionzilla" className="logo-mark" />
            {!isSidebarCollapsed && <h1 className="logo-text">Sessionzilla</h1>}
          </div>
          <div className="sidebar-header-actions">
            {!isSidebarCollapsed && (
              <button onClick={toggleLang} className="btn-lang">{lang === 'en' ? 'ES' : 'EN'}</button>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(prev => !prev)}
              className="btn-subtle sidebar-toggle-btn"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
        </div>

        {!isSidebarCollapsed && (
          <>
            <nav className="sidebar-nav">
              <div className="nav-group">
                <div className="nav-group-header">
                  <span>{t('projectsTitle')}</span>
                  <button onClick={() => { if (window.confirm('Clear current work?')) { setRecords([]); setResult(null); setActiveProjectId(null); setProjectVersions([]); setLoadedVersionId(null); } }} className="btn-icon-alt" title={t('projectNew')}>
                    <Plus size={16} />
                  </button>
                </div>
                <div className="project-list">
                  {projects.length === 0 && <p className="empty-text">{t('historyEmpty')}</p>}
                  {projects.map(p => (
                    <div key={p.id} className={`project-item ${activeProjectId === p.id ? 'active' : ''}`} onClick={() => { void loadProjectSnapshot(p.id, p.activeVersionId); }}>
                      <div className="project-info">
                        <span className="project-name">
                          {p.name}
                          {p.publicApiVersionId && <span className="project-public-pill"><Globe size={11} /> Public API</span>}
                        </span>
                        <span className="project-date">{new Date(p.updatedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="project-actions">
                        <button onClick={(e) => { e.stopPropagation(); handleRenameProject(p.id); }} className="btn-subtle"><Pencil size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }} className="btn-subtle danger"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {activeProjectId && (
                <div className="nav-group" style={{ marginTop: '1.5rem' }}>
                  <div className="nav-group-header"><span>{t('versionsTitle')}</span><History size={16} /></div>
                <div className="version-list">
                  {projectVersions.map(v => (
                    <div key={v.id} className={`version-item ${loadedVersionId === v.id ? 'active' : ''}`} onClick={() => handleLoadVersion(v)}>
                      <span className="version-num">v{v.versionNumber}</span>
                      <span className="version-label">{v.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleSetPublicApiSource(v.projectId, v.id); }}
                          className={`btn-subtle ${publicSourceVersionId === v.id ? 'public-source' : ''}`}
                          title={publicSourceVersionId === v.id ? t('publicApiSourceLabel') : t('publicApiSetSource')}
                        >
                          <Globe size={12} />
                        </button>
                        {loadedVersionId === v.id && <CheckCircle2 size={12} className="active-icon" />}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteVersion(v); }}
                          className="btn-subtle danger"
                          title={t('versionDelete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              )}
            </nav>
            <div className="sidebar-footer">
              <div className={`sync-badge ${repository.runtimeAvailable ? 'online' : 'offline'}`}>
                {repository.runtimeAvailable ? 'Runtime Online' : 'Runtime Offline'}
              </div>
            </div>
          </>
        )}
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            {activeProjectId ? (
              <div className="active-project-tag">
                <span className="tag-label">PROJECT:</span>
                <span className="tag-value">{projects.find(p => p.id === activeProjectId)?.name}</span>
                {loadedVersionId && <span className="tag-version">v{projectVersions.find(v => v.id === loadedVersionId)?.versionNumber}</span>}
                {loadedVersionId && publicSourceVersionId === loadedVersionId && <span className="tag-public-source"><Globe size={12} /> {t('publicApiSourceLabel')}</span>}
              </div>
            ) : <h2 className="page-title">{t('appTitle')}</h2>}
          </div>
          <div className="top-bar-right">
            {publicApiStatus?.publicSource && (
              <div className="autosave-indicator top-bar-status">
                <Link2 size={14} />
                {t('publicApiCurrentSource')}: {projects.find(p => p.id === publicApiStatus.publicSource?.projectId)?.name ?? 'Project'} / v{projectVersions.find(v => v.id === publicApiStatus.publicSource?.versionId)?.versionNumber ?? '?'}
              </div>
            )}
            <div className="top-bar-actions">
              <button onClick={handleRenameEditor} className="editor-chip" title={t('editorChipTitle')}>
                <span className="editor-chip-icon"><Pencil size={13} /></span>
                <span className="editor-chip-copy">
                  <span className="editor-chip-label">{t('editorChipLabel')}</span>
                  <span className="editor-chip-name">{editorIdentity.name || t('editorChipUnset')}</span>
                </span>
              </button>
              {autosaveStatus !== 'idle' && (
                <div className={`autosave-indicator top-bar-status-pill status-${autosaveStatus}`}>
                  {autosaveStatus === 'saving' ? <Loader2 className="animate-spin" size={14} /> :
                    autosaveStatus === 'conflict' ? <ShieldAlert size={14} /> :
                      <CheckCircle2 size={14} />}

                  {autosaveStatus === 'saving' ? t('autosaveSaving') :
                    autosaveStatus === 'conflict' ? t('autosaveConflict') :
                      t('autosaveSaved')}
                </div>
              )}

              {result && (
                <div className="top-bar-cta-group">
                {!activeProjectId ? (
                  <button onClick={handleCreateProject} className="btn btn-primary top-bar-cta" style={{ gap: '0.5rem' }}><Save size={16} /> {t('projectNew')}</button>
                ) : (
                  <>
                    <button onClick={handleSaveCurrentVersion} className="btn btn-secondary top-bar-cta" style={{ gap: '0.5rem' }} disabled={!loadedVersionId || !editorReady}><Save size={16} /> {t('versionSaveCurrent')}</button>
                    <button onClick={handleSaveVersion} className="btn btn-primary top-bar-cta" style={{ gap: '0.5rem' }} disabled={!editorReady}><Save size={16} /> {t('versionSave')}</button>
                  </>
                )}
                </div>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="error-banner" style={{ margin: '1rem 1.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="btn-subtle" style={{ color: 'inherit' }}><Plus size={16} style={{ transform: 'rotate(45deg)' }} /></button>
          </div>
        )}

        {remoteChangesAvailable && loadedVersionId && (
          <div className="warning-banner" style={{ margin: '1rem 1.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <RefreshCw size={16} />
              <span>{t('remoteChangesAvailable')}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={handleReviewRemoteChanges} className="btn btn-secondary" style={{ gap: '0.4rem' }}>
                <GitBranch size={14} /> {t('reviewRemoteChanges')}
              </button>
              <button onClick={handleReloadLatestVersion} className="btn btn-secondary" style={{ gap: '0.4rem' }}>
                <RotateCcw size={14} /> {t('conflictReload')}
              </button>
              <button onClick={handleSaveVersion} className="btn btn-primary" style={{ gap: '0.4rem' }}>
                <Save size={14} /> {t('versionSave')}
              </button>
            </div>
          </div>
        )}

        {!records.length ? (
          <FileUpload onFileSelect={handleFileSelect} />
        ) : !result ? (
          <div className="fade-in" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>{t('setupConfig')}</h2>
              <button 
                onClick={() => { if (window.confirm(t('historyConfirmDelete'))) setRecords([]); }} 
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <RotateCcw size={16} /> {t('uploadDifferent')}
              </button>
            </div>
            <Configurator assumptions={assumptions} onAssumptionsChange={setAssumptions} startHour={startHour} endHour={endHour} onTimeChange={(s, e) => { setStartHour(s); setEndHour(e); }} />
            <div className="grid-2-cols" style={{ marginTop: '1.5rem' }}>
              <RuleBuilder rules={rules} onChange={setRules} uniqueValuesMap={uniqueValuesMap} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <Randomizer title="F&S Assignment Targets" description="Distribute 'F&S' associates without manual rules." distributions={fsDistributions} onChange={setFsDistributions} targetSAs={['Cloud ERP', 'oCFO']} />
                <Randomizer title="IAE Assignment Targets" description="Distribute 'IAE' associates without manual rules." distributions={aeDistributions} onChange={setAeDistributions} targetSAs={['Cloud ERP', 'Data & AI', 'BTP', 'oCFO']} />
              </div>
            </div>
            <div className="action-footer">
              <button onClick={handleRun} className="btn btn-large btn-primary" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : t('runAllocation')}
              </button>
            </div>
          </div>
        ) : (
          <Dashboard
            localRecords={dashboardRecords}
            localMetrics={dashboardMetrics || (result.metrics as AllocationResult['metrics'])}
            result={result}
            onReset={() => { setResult(null); setLoadedVersionId(null); }}
            previousMetrics={previousMetrics}
            sessionLength={assumptions.sessionLength}
            facultyStartHour={assumptions.facultyStartHour ?? 6}
            sessionTimeOverrides={sessionTimeOverrides}
            sessionInstanceTimeOverrides={sessionInstanceTimeOverrides}
            onSessionInstanceTimeOverridesChange={setSessionInstanceTimeOverrides}
            manualSmeAssignments={manualSmeAssignments}
            smeConfirmationState={smeConfirmationState}
            onSmeConfirmationStateChange={setSmeConfirmationState}
            onManualSmeAssignmentsChange={setManualSmeAssignments}
            manualFacultyAssignments={manualFacultyAssignments}
            onManualFacultyAssignmentsChange={setManualFacultyAssignments}
            evaluationsOutput={evaluationsOutput}
            onEvaluationsOutputChange={setEvaluationsOutput}
            onLocalMetricsChange={setDashboardMetrics}
            onLocalRecordsChange={setDashboardRecords}
            projectName={projects.find(p => p.id === activeProjectId)?.name ?? null}
            versionLabel={loadedVersionId ? `v${projectVersions.find(v => v.id === loadedVersionId)?.versionNumber ?? ''}` : null}
            projectId={activeProjectId}
            versionId={loadedVersionId}
            smeList={smeList}
            smeStatus={smeStatus}
            onRefreshSMEs={() => { void refreshSmes(); }}
            onRefreshApiSnapshots={handleRefreshApiSnapshots}
            versionInfo={
              loadedVersionId ? (
                <div className="version-status-box" style={{ padding: '0.5rem', marginTop: '0.5rem' }}>
                  <div className="version-tag"><Clock size={14} /> v{loadedVersion?.versionNumber}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.45rem' }}>
                    {t('lastSavedByLabel')}: <strong>{loadedVersion?.savedBy ?? t('unknownEditor')}</strong>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem' }}>
                    {t('lastUpdatedLabel')}: <strong>{formatRelativeTimestamp(loadedVersion?.createdAt)}</strong>
                  </div>
                  <div style={{
                    fontSize: '0.72rem',
                    marginTop: '0.45rem',
                    color: isViewingLatestVersion ? '#15803d' : '#b45309',
                    background: isViewingLatestVersion ? '#f0fdf4' : '#fff7ed',
                    border: `1px solid ${isViewingLatestVersion ? '#bbf7d0' : '#fed7aa'}`,
                    borderRadius: '9999px',
                    padding: '0.28rem 0.55rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontWeight: 700,
                  }}>
                    <CheckCircle2 size={12} />
                    {isViewingLatestVersion ? t('versionLatestStatus') : t('versionOutdatedStatus')}
                  </div>
                  {otherEditors.length > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#2563eb', marginTop: '0.45rem' }}>
                      {t('otherEditorsLabel')}: <strong>{otherEditors.map(item => item.editor.name).join(', ')}</strong>
                    </div>
                  )}
                  {!isViewingLatestVersion && (
                    <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                      <button onClick={() => { if (window.confirm(t('reloadVersionConfirm'))) void handleReloadLatestVersion(); }} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}><RotateCcw size={12} /> {t('versionRefreshLatest')}</button>
                    </div>
                  )}
                </div>
              ) : null
            }
          />
        )}

      </main>

      {conflictState && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          zIndex: 1000,
        }}>
          <div style={{
            width: 'min(960px, 100%)',
            maxHeight: '85vh',
            overflow: 'auto',
            background: '#fff',
            borderRadius: '16px',
            padding: '1.5rem',
            boxShadow: '0 20px 50px rgba(15,23,42,0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}>
            <div>
              <h3 style={{ margin: 0 }}>{t('conflictTitle')}</h3>
              <p style={{ margin: '0.35rem 0 0', color: '#64748b' }}>
                {t('conflictMergeSummary')
                  .replace('{merged}', String(conflictState.autoMergedCount))
                  .replace('{conflicts}', String(conflictState.conflicts.length))}
              </p>
            </div>

            {conflictState.conflicts.length === 0 ? (
              <div style={{ padding: '1rem', borderRadius: '12px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                {t('conflictNoManualChoices')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {conflictState.conflicts.map(conflict => (
                  <div key={conflict.id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.65rem' }}>{conflict.label}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' }}>{conflict.path.join(' / ')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
                      <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>{t('conflictOriginal')}</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.74rem' }}>{JSON.stringify(conflict.baseValue, null, 2)}</pre>
                      </div>
                      <button
                        onClick={() => setConflictState(prev => prev ? ({
                          ...prev,
                          resolutions: { ...prev.resolutions, [conflict.id]: 'local' },
                        }) : prev)}
                        className="btn btn-secondary"
                        style={{
                          textAlign: 'left',
                          justifyContent: 'flex-start',
                          borderColor: conflictState.resolutions[conflict.id] === 'local' ? '#3b82f6' : undefined,
                          background: conflictState.resolutions[conflict.id] === 'local' ? '#eff6ff' : undefined,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>{t('conflictKeepMine')}</div>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.74rem' }}>{JSON.stringify(conflict.localValue, null, 2)}</pre>
                        </div>
                      </button>
                      <button
                        onClick={() => setConflictState(prev => prev ? ({
                          ...prev,
                          resolutions: { ...prev.resolutions, [conflict.id]: 'remote' },
                        }) : prev)}
                        className="btn btn-secondary"
                        style={{
                          textAlign: 'left',
                          justifyContent: 'flex-start',
                          borderColor: conflictState.resolutions[conflict.id] === 'remote' ? '#10b981' : undefined,
                          background: conflictState.resolutions[conflict.id] === 'remote' ? '#ecfdf5' : undefined,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>{t('conflictKeepRemote')}</div>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.74rem' }}>{JSON.stringify(conflict.remoteValue, null, 2)}</pre>
                        </div>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={handleReloadLatestVersion} className="btn btn-secondary" style={{ gap: '0.4rem' }}>
                  <RotateCcw size={14} /> {t('conflictReload')}
                </button>
                <button onClick={handleSaveVersion} className="btn btn-secondary" style={{ gap: '0.4rem' }}>
                  <Save size={14} /> {t('versionSave')}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={() => setConflictState(null)} className="btn btn-secondary">
                  {t('cancel')}
                </button>
                <button onClick={handleSaveMergedConflict} className="btn btn-primary" style={{ gap: '0.4rem' }}>
                  <Save size={14} /> {t('conflictSaveMerged')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLatestVersionPrompt && loadedVersion && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.42)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          zIndex: 1050,
        }}>
          <div style={{
            width: 'min(440px, 100%)',
            background: '#fff',
            borderRadius: '18px',
            padding: '1.35rem',
            boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#b45309' }}>
              <RefreshCw size={18} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>{t('versionModalTitle')}</h3>
            </div>
            <p style={{ margin: 0, color: '#475569', lineHeight: 1.55, fontSize: '0.92rem' }}>
              {t('versionModalDescription')
                .replace('{current}', `v${loadedVersion.versionNumber}`)}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
              <button
                onClick={() => setDismissedLatestVersionPromptFor(loadedVersionId)}
                className="btn btn-secondary"
              >
                {t('versionModalDismiss')}
              </button>
              <button
                onClick={() => { void handleReloadLatestVersion(); }}
                className="btn btn-primary"
                style={{ gap: '0.45rem' }}
              >
                <RotateCcw size={14} /> {t('versionRefreshLatest')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!editorReady && (
        <div className="editor-gate">
          <div className="editor-gate-card">
            <div className="editor-gate-badge">
              <Pencil size={14} />
              {t('editorChipLabel')}
            </div>
            <h2 className="editor-gate-title">{t('editorGateTitle')}</h2>
            <p className="editor-gate-description">{t('editorGateDescription')}</p>
            <div className="editor-gate-form">
              <input
                type="text"
                value={pendingEditorName}
                onChange={(event) => setPendingEditorName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCompleteEditorSetup();
                  }
                }}
                className="editor-gate-input"
                placeholder={t('editorGatePlaceholder')}
                autoFocus
              />
              <button onClick={handleCompleteEditorSetup} className="btn btn-primary editor-gate-button">
                {t('editorGateContinue')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .app-container { display: flex; height: 100vh; overflow: hidden; background: #f8fafc; }
        .sidebar { width: 280px; background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,245,255,0.98) 100%); border-right: 1px solid #eadcff; display: flex; flex-direction: column; transition: width 0.2s ease; box-shadow: inset -1px 0 0 rgba(255,255,255,0.7); }
        .sidebar.collapsed { width: 78px; }
        .sidebar-header { padding: 1.5rem; border-bottom: 1px solid #f3e8ff; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,247,237,0.82) 100%); }
        .sidebar.collapsed .sidebar-header { padding: 1rem 0.75rem; }
        .sidebar-header-actions { display: flex; align-items: center; gap: 0.5rem; }
        .logo-text { font-size: 1.25rem; font-weight: 900; color: #1e293b; letter-spacing: -0.035em; text-shadow: 0 1px 0 rgba(255,255,255,0.7); }
        .logo-mark { width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0; box-shadow: 0 10px 24px rgba(91, 71, 244, 0.18); }
        .sidebar-toggle-btn { border: 1px solid #d8b4fe; color: #7c3aed; background: rgba(255,255,255,0.75); }
        .sidebar-nav { flex: 1; overflow-y: auto; padding: 1.5rem; }
        .nav-group-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; color: #64748b; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .project-list, .version-list { display: flex; flex-direction: column; gap: 0.25rem; }
        .project-item, .version-item { padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; border: 1px solid transparent; }
        .project-item:hover, .version-item:hover { background: #faf5ff; }
        .project-item.active { background: linear-gradient(135deg, #f5f3ff 0%, #fff7ed 100%); border-color: #d8b4fe; box-shadow: 0 10px 24px rgba(124, 58, 237, 0.08); }
        .project-name { display: block; font-weight: 600; color: #1e293b; font-size: 0.9rem; }
        .project-public-pill { display: inline-flex; align-items: center; gap: 0.25rem; margin-left: 0.4rem; padding: 0.1rem 0.35rem; border-radius: 9999px; background: #f5f3ff; color: #6d28d9; font-size: 0.65rem; font-weight: 700; vertical-align: middle; }
        .project-date { font-size: 0.7rem; color: #94a3b8; }
        .version-item.active { background: linear-gradient(135deg, #ecfeff 0%, #f5f3ff 100%); border-color: #c4b5fd; color: #4c1d95; }
        .version-num { font-weight: 800; font-size: 0.8rem; margin-right: 0.5rem; }
        .version-label { font-size: 0.85rem; flex: 1; }
        .btn-subtle { background: none; border: none; padding: 0.25rem; cursor: pointer; color: #94a3b8; border-radius: 0.25rem; }
        .btn-subtle:hover { background: #f3e8ff; color: #6d28d9; }
        .btn-subtle.public-source { background: linear-gradient(135deg, #ede9fe 0%, #fff7ed 100%); color: #7c3aed; }
        .btn-subtle.danger:hover { background: #fee2e2; color: #dc2626; }
        .main-content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
        .top-bar { min-height: 72px; background: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(252,246,255,0.92) 100%); border-bottom: 1px solid #efe4ff; display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.75rem 1.5rem; flex-shrink: 0; box-shadow: 0 8px 22px rgba(91, 71, 244, 0.05); }
        .top-bar-left { min-width: 0; }
        .top-bar-right { display: flex; align-items: center; justify-content: flex-end; gap: 0.85rem; flex: 1; min-width: 0; flex-wrap: wrap; }
        .top-bar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap; flex: 1; min-width: 0; }
        .top-bar-cta-group { display: flex; align-items: stretch; gap: 0.75rem; flex-wrap: wrap; justify-content: flex-end; }
        .top-bar-cta { min-height: 52px; padding: 0 1.25rem; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.07); }
        .active-project-tag { display: flex; align-items: center; gap: 0.5rem; background: linear-gradient(135deg, #ffffff 0%, #fff7ed 100%); padding: 0.35rem 0.75rem; border-radius: 9999px; border: 1px solid #fed7aa; box-shadow: 0 10px 24px rgba(249, 115, 22, 0.08); }
        .tag-label { font-size: 0.65rem; font-weight: 800; color: #64748b; }
        .tag-value { font-size: 0.85rem; font-weight: 600; color: #1e293b; }
        .tag-version { background: linear-gradient(135deg, var(--primary-color) 0%, #7c3aed 100%); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 4px; box-shadow: 0 6px 16px rgba(91, 71, 244, 0.2); }
        .tag-public-source { display: inline-flex; align-items: center; gap: 0.25rem; background: linear-gradient(135deg, #ede9fe 0%, #fff7ed 100%); color: #7c3aed; font-size: 0.68rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 9999px; }
        .autosave-indicator { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: #64748b; margin-right: 1rem; }
        .top-bar-status { flex-shrink: 0; margin-right: 0; }
        .top-bar-status-pill { margin-right: 0; padding: 0.65rem 0.9rem; border-radius: 9999px; background: linear-gradient(180deg, #ffffff 0%, #faf5ff 100%); border: 1px solid #e9d5ff; }
        .editor-chip { display: inline-flex; align-items: center; gap: 0.55rem; min-width: 0; max-width: 260px; border: 1px solid #f5d0fe; background: linear-gradient(135deg, #ffffff 0%, #fff7ed 52%, #faf5ff 100%); color: #0f172a; border-radius: 9999px; padding: 0.45rem 0.8rem 0.45rem 0.55rem; cursor: pointer; box-shadow: 0 8px 20px rgba(91, 71, 244, 0.08); transition: all 0.18s ease; }
        .editor-chip:hover { transform: translateY(-1px); box-shadow: 0 12px 26px rgba(91, 71, 244, 0.12); border-color: #c4b5fd; }
        .editor-chip-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: 9999px; background: linear-gradient(135deg, #ede9fe 0%, #ffedd5 100%); color: #7c3aed; flex-shrink: 0; }
        .editor-chip-copy { display: inline-flex; align-items: baseline; gap: 0.4rem; min-width: 0; white-space: nowrap; }
        .editor-chip-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; font-weight: 700; flex-shrink: 0; }
        .editor-chip-name { font-size: 0.86rem; font-weight: 700; color: #0f172a; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .editor-gate { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background:
          radial-gradient(circle at top left, rgba(249, 115, 22, 0.18), transparent 28%),
          radial-gradient(circle at bottom right, rgba(91, 71, 244, 0.18), transparent 26%),
          rgba(15, 23, 42, 0.82); backdrop-filter: blur(6px); }
        .editor-gate-card { width: min(520px, 100%); background: linear-gradient(180deg, #ffffff 0%, #fff7ed 50%, #faf5ff 100%); border: 1px solid rgba(244, 114, 182, 0.18); border-radius: 24px; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.35); padding: 1.75rem; display: flex; flex-direction: column; gap: 1rem; }
        .editor-gate-badge { display: inline-flex; align-items: center; gap: 0.45rem; align-self: flex-start; padding: 0.35rem 0.65rem; border-radius: 9999px; background: linear-gradient(135deg, #ede9fe 0%, #ffedd5 100%); color: #7c3aed; font-size: 0.76rem; font-weight: 700; }
        .editor-gate-title { margin: 0; font-size: 1.5rem; line-height: 1.1; color: #0f172a; }
        .editor-gate-description { margin: 0; color: #475569; line-height: 1.6; font-size: 0.96rem; }
        .editor-gate-form { display: flex; flex-direction: column; gap: 0.85rem; }
        .editor-gate-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 14px; background: #fff; padding: 0.9rem 1rem; font-size: 0.98rem; color: #0f172a; outline: none; box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.03); transition: border-color 0.16s ease, box-shadow 0.16s ease; }
        .editor-gate-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12); }
        .editor-gate-button { width: 100%; justify-content: center; }
        .sync-badge { padding: 0.25rem 0.5rem; font-size: 0.65rem; font-weight: 700; border-radius: 4px; text-transform: uppercase; }
        .sync-badge.online { background: #dcfce7; color: #166534; }
        .sync-badge.offline { background: #fee2e2; color: #991b1b; }
        .sidebar-footer { padding: 1rem; border-top: 1px solid #f1f5f9; text-align: center; }
        .version-status-box { display: flex; flex-direction: column; background: #f1f5f9; padding: 0.5rem; border-radius: 6px; }
        .version-tag { font-size: 0.75rem; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 0.25rem; }
        @media (max-width: 1080px) {
          .top-bar { align-items: flex-start; }
          .top-bar-right { justify-content: flex-start; }
          .top-bar-actions { justify-content: flex-start; }
        }
        @media (max-width: 640px) {
          .top-bar { padding: 0.75rem 1rem; }
          .top-bar-cta-group { width: 100%; }
          .top-bar-cta { width: 100%; }
          .editor-gate-card { padding: 1.25rem; border-radius: 20px; }
          .editor-gate-title { font-size: 1.25rem; }
          .editor-chip { max-width: 180px; }
          .editor-chip-label { display: none; }
        }
      `}</style>
    </div>
  );
}

export default App;
