import * as SQLite from 'expo-sqlite';
import { StateStorage } from 'zustand/middleware';

export const KV_DATABASE_NAME = 'ysclaude_kv.db';

let kvDb: SQLite.SQLiteDatabase | null = null;
// 与 database.ts 的 getDatabase() 同理：缓存 in-flight Promise，
// 防止冷启动时多个并发调用者各自 openDatabaseAsync 导致竞态——
// 后打开的连接覆盖先打开的、或在建表完成前就被使用，
// 引发 NativeDatabase.execAsync 的 NullPointerException。
let kvInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getKVDb(): Promise<SQLite.SQLiteDatabase> {
  if (kvDb) return kvDb;
  if (kvInitPromise) return kvInitPromise;

  kvInitPromise = (async () => {
    const opened = await SQLite.openDatabaseAsync(KV_DATABASE_NAME);
    await opened.execAsync(
      `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    );
    kvDb = opened;
    return opened;
  })();

  try {
    return await kvInitPromise;
  } catch (e) {
    kvInitPromise = null;
    throw e;
  }
}

export async function serializeKVDatabase(): Promise<Uint8Array> {
  const db = await getKVDb();
  return await db.serializeAsync();
}

export async function closeKVDatabaseConnection(): Promise<string | null> {
  const opened = kvDb || (kvInitPromise ? await kvInitPromise.catch(() => null) : null);
  const databasePath = opened?.databasePath ?? null;
  if (opened) {
    await opened.closeAsync();
  }
  kvDb = null;
  kvInitPromise = null;
  return databasePath;
}

export const sqliteStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await getKVDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      [name]
    );
    return row?.value ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const db = await getKVDb();
    await db.runAsync(
      'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
      [name, value]
    );
  },
  removeItem: async (name: string): Promise<void> => {
    const db = await getKVDb();
    await db.runAsync('DELETE FROM kv WHERE key = ?', [name]);
  },
};
