import { create } from 'zustand';
import { randomUUID } from 'expo-crypto';
import { PeriodRecord } from '../types';
import {
  createPeriodRecord,
  deletePeriodRecord,
  getAllPeriodRecords,
  updatePeriodRecord,
} from '../db/operations';
import { addDaysToDateKey } from '../utils/periods';

interface PeriodState {
  periodRecords: PeriodRecord[];
  loadPeriodRecords: () => Promise<void>;
  addPeriodRecord: (startDate: string, endDate: string | null) => Promise<void>;
  editPeriodRecord: (id: string, updates: { startDate?: string; endDate?: string | null }) => Promise<void>;
  removePeriodRecord: (id: string) => Promise<void>;
}

type CompletedPeriodRecord = PeriodRecord & { endDate: string };

function isCompletedRecord(record: PeriodRecord): record is CompletedPeriodRecord {
  return !!record.endDate;
}

function compareByStartDate(a: PeriodRecord, b: PeriodRecord): number {
  return b.startDate.localeCompare(a.startDate);
}

function canMergeRecords(current: CompletedPeriodRecord, next: CompletedPeriodRecord): boolean {
  return next.startDate <= addDaysToDateKey(current.endDate, 1);
}

async function mergeCompletedRecords(records: PeriodRecord[]): Promise<PeriodRecord[]> {
  const completed = records.filter(isCompletedRecord).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const pending = records.filter((record) => !record.endDate);
  const merged: CompletedPeriodRecord[] = [];
  const deleteIds = new Set<string>();
  const now = Date.now();

  for (const record of completed) {
    const current = merged[merged.length - 1];
    if (!current || !canMergeRecords(current, record)) {
      merged.push({ ...record });
      continue;
    }

    deleteIds.add(record.id);
    if (record.endDate > current.endDate) {
      current.endDate = record.endDate;
    }
    current.updatedAt = now;
  }

  for (const record of merged) {
    const original = completed.find((item) => item.id === record.id);
    if (!original) continue;
    if (
      original.startDate !== record.startDate ||
      original.endDate !== record.endDate ||
      original.updatedAt !== record.updatedAt
    ) {
      await updatePeriodRecord(record.id, {
        startDate: record.startDate,
        endDate: record.endDate,
        updatedAt: record.updatedAt,
      });
    }
  }

  for (const id of deleteIds) {
    await deletePeriodRecord(id);
  }

  return [...merged, ...pending].sort(compareByStartDate);
}

export const usePeriodStore = create<PeriodState>((set) => ({
  periodRecords: [],

  loadPeriodRecords: async () => {
    const periodRecords = await mergeCompletedRecords(await getAllPeriodRecords());
    set({ periodRecords });
  },

  addPeriodRecord: async (startDate: string, endDate: string | null) => {
    const now = Date.now();
    const record: PeriodRecord = {
      id: randomUUID(),
      startDate,
      endDate,
      createdAt: now,
      updatedAt: now,
    };
    await createPeriodRecord(record);
    const periodRecords = await mergeCompletedRecords(await getAllPeriodRecords());
    set({ periodRecords });
  },

  editPeriodRecord: async (id: string, updates: { startDate?: string; endDate?: string | null }) => {
    const now = Date.now();
    await updatePeriodRecord(id, { ...updates, updatedAt: now });
    const periodRecords = await mergeCompletedRecords(await getAllPeriodRecords());
    set({ periodRecords });
  },

  removePeriodRecord: async (id: string) => {
    await deletePeriodRecord(id);
    set((state) => ({
      periodRecords: state.periodRecords.filter((record) => record.id !== id),
    }));
  },
}));
