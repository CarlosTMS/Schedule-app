import type { AllocationResult } from './allocationEngine';
import { calculateMetrics } from './allocationEngine';
import type { StudentRecord } from './excelParser';
import type { EditorIdentity } from './runHistoryRepository';
import type { RunSnapshot } from './runHistoryStorage';

const EDITOR_ID_KEY = 'scheduler_editor_id_v1';
const EDITOR_NAME_KEY = 'scheduler_editor_name_v1';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const isEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface MergeConflict {
  id: string;
  label: string;
  path: string[];
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
}

export interface MergeResult {
  mergedSnapshot: RunSnapshot;
  conflicts: MergeConflict[];
  autoMergedCount: number;
}

export const getEditorIdentity = (): EditorIdentity => {
  const existingId = localStorage.getItem(EDITOR_ID_KEY);
  const existingName = localStorage.getItem(EDITOR_NAME_KEY);
  if (existingId) {
    return { id: existingId, name: existingName?.trim() ?? '' };
  }

  const id = Math.random().toString(36).slice(2, 10);
  localStorage.setItem(EDITOR_ID_KEY, id);
  if (existingName !== null) {
    localStorage.setItem(EDITOR_NAME_KEY, existingName);
  }
  return { id, name: existingName?.trim() ?? '' };
};

export const setEditorIdentityName = (name: string): EditorIdentity => {
  const identity = getEditorIdentity();
  const trimmed = name.trim();
  const next = { ...identity, name: trimmed };
  localStorage.setItem(EDITOR_NAME_KEY, next.name);
  return next;
};

export const hasEditorIdentityName = (identity: EditorIdentity | null | undefined): boolean =>
  Boolean(identity?.name?.trim());

export const formatRelativeTimestamp = (iso: string | null | undefined): string => {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
};

const mergeValue = (
  label: string,
  path: string[],
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown
): { value: unknown; conflicts: MergeConflict[]; autoMergedCount: number } => {
  if (isEqual(localValue, remoteValue)) {
    return { value: clone(localValue), conflicts: [], autoMergedCount: 0 };
  }
  if (isEqual(localValue, baseValue)) {
    return { value: clone(remoteValue), conflicts: [], autoMergedCount: 1 };
  }
  if (isEqual(remoteValue, baseValue)) {
    return { value: clone(localValue), conflicts: [], autoMergedCount: 1 };
  }

  if (isPlainObject(baseValue) || isPlainObject(localValue) || isPlainObject(remoteValue)) {
    const baseObj = isPlainObject(baseValue) ? baseValue : {};
    const localObj = isPlainObject(localValue) ? localValue : {};
    const remoteObj = isPlainObject(remoteValue) ? remoteValue : {};
    const keys = new Set([...Object.keys(baseObj), ...Object.keys(localObj), ...Object.keys(remoteObj)]);
    const merged: Record<string, unknown> = {};
    const conflicts: MergeConflict[] = [];
    let autoMergedCount = 0;

    for (const key of keys) {
      const next = mergeValue(label, [...path, key], baseObj[key], localObj[key], remoteObj[key]);
      merged[key] = next.value;
      conflicts.push(...next.conflicts);
      autoMergedCount += next.autoMergedCount;
    }

    return { value: merged, conflicts, autoMergedCount };
  }

  return {
    value: clone(localValue),
    conflicts: [{
      id: path.join('.'),
      label,
      path,
      baseValue: clone(baseValue),
      localValue: clone(localValue),
      remoteValue: clone(remoteValue),
    }],
    autoMergedCount: 0,
  };
};

const mergeRecords = (base: StudentRecord[], local: StudentRecord[], remote: StudentRecord[]) => {
  const byId = (records: StudentRecord[]) =>
    new Map(records.map((record, index) => [record._originalIndex ?? index, record]));
  const baseMap = byId(base);
  const localMap = byId(local);
  const remoteMap = byId(remote);
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const merged: StudentRecord[] = [];
  const conflicts: MergeConflict[] = [];
  let autoMergedCount = 0;

  const editableFields: Array<keyof StudentRecord> = ['Schedule', 'VAT', 'Solution Weeks SA'];

  for (const id of Array.from(ids).sort((a, b) => a - b)) {
    const baseRecord = baseMap.get(id);
    const localRecord = localMap.get(id);
    const remoteRecord = remoteMap.get(id);
    const template = clone(remoteRecord ?? localRecord ?? baseRecord);
    if (!template) continue;

    for (const field of editableFields) {
      const mergedField = mergeValue(
        `Record ${id} ${String(field)}`,
        ['records', String(id), String(field)],
        baseRecord?.[field],
        localRecord?.[field],
        remoteRecord?.[field]
      );
      (template as any)[field] = mergedField.value;
      conflicts.push(...mergedField.conflicts);
      autoMergedCount += mergedField.autoMergedCount;
    }

    merged.push(template);
  }

  return { value: merged, conflicts, autoMergedCount };
};

const finalizeResult = (snapshot: RunSnapshot): AllocationResult => {
  const metrics = calculateMetrics(snapshot.records);
  const result = snapshot.result
    ? {
        ...snapshot.result,
        records: snapshot.records,
        metrics,
      }
    : ({
        records: snapshot.records,
        metrics,
        config: {
          startHour: snapshot.startHour,
          endHour: snapshot.endHour,
          assumptions: snapshot.assumptions,
          rules: snapshot.rules,
          fsDistributions: snapshot.fsDistributions,
          aeDistributions: snapshot.aeDistributions,
        },
      } as AllocationResult);

  return result;
};

export const mergeSnapshots = (base: RunSnapshot, local: RunSnapshot, remote: RunSnapshot): MergeResult => {
  const mergedSnapshot = clone(local);
  const conflicts: MergeConflict[] = [];
  let autoMergedCount = 0;

  const recordMerge = mergeRecords(base.records, local.records, remote.records);
  mergedSnapshot.records = recordMerge.value;
  conflicts.push(...recordMerge.conflicts);
  autoMergedCount += recordMerge.autoMergedCount;

  const sections: Array<{ key: keyof RunSnapshot; label: string }> = [
    { key: 'assumptions', label: 'Assumptions' },
    { key: 'rules', label: 'Rules' },
    { key: 'fsDistributions', label: 'F&S distributions' },
    { key: 'aeDistributions', label: 'IAE distributions' },
    { key: 'startHour', label: 'Start hour' },
    { key: 'endHour', label: 'End hour' },
    { key: 'sessionTimeOverrides', label: 'Session time overrides' },
    { key: 'sessionInstanceTimeOverrides', label: 'Session instance overrides' },
    { key: 'manualSmeAssignments', label: 'SME assignments' },
    { key: 'smeConfirmationState', label: 'SME confirmations' },
    { key: 'manualFacultyAssignments', label: 'Faculty assignments' },
    { key: 'evaluationsOutput', label: 'Evaluations' },
  ];

  for (const section of sections) {
    const merged = mergeValue(
      section.label,
      [String(section.key)],
      base[section.key],
      local[section.key],
      remote[section.key]
    );
    mergedSnapshot[section.key] = merged.value as never;
    conflicts.push(...merged.conflicts);
    autoMergedCount += merged.autoMergedCount;
  }

  mergedSnapshot.result = finalizeResult(mergedSnapshot);

  return {
    mergedSnapshot,
    conflicts,
    autoMergedCount,
  };
};

export const applyConflictResolutions = (
  snapshot: RunSnapshot,
  conflicts: MergeConflict[],
  resolutions: Record<string, 'local' | 'remote'>
): RunSnapshot => {
  const next = clone(snapshot) as unknown as Record<string, unknown>;
  for (const conflict of conflicts) {
    const resolvedValue = resolutions[conflict.id] === 'remote' ? conflict.remoteValue : conflict.localValue;
    let cursor: unknown = next;
    for (let index = 0; index < conflict.path.length - 1; index += 1) {
      const segment = conflict.path[index];
      const nextSegment = conflict.path[index + 1];
      if (Array.isArray(cursor)) {
        const arrayIndex = Number(segment);
        if (!cursor[arrayIndex]) {
          cursor[arrayIndex] = /^\d+$/.test(nextSegment) ? [] : {};
        }
        cursor = cursor[arrayIndex];
        continue;
      }

      const objectCursor = cursor as Record<string, unknown>;
      if (objectCursor[segment] === undefined || objectCursor[segment] === null) {
        objectCursor[segment] = /^\d+$/.test(nextSegment) ? [] : {};
      }
      cursor = objectCursor[segment];
    }

    const finalSegment = conflict.path[conflict.path.length - 1];
    if (Array.isArray(cursor)) {
      cursor[Number(finalSegment)] = clone(resolvedValue);
    } else {
      (cursor as Record<string, unknown>)[finalSegment] = clone(resolvedValue);
    }
  }

  const resolved = next as unknown as RunSnapshot;
  resolved.result = finalizeResult(resolved);
  return resolved;
};
