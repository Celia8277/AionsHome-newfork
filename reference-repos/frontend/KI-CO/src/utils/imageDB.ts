const DB_NAME = "KicoImageDB";
const STORE_NAME = "images";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
const warnedMissingImages = new Set<string>();

function warnMissingImage(id: string, error: unknown) {
  if (warnedMissingImages.has(id)) return;
  warnedMissingImages.add(id);
  console.warn("[ImageDB] Image record is missing or corrupted; skipping it:", id, error);
}

export const imageDB = {
  async init(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
    });

    return dbPromise;
  },

  async saveImage(dataUrl: string): Promise<string> {
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ id, data: dataUrl, timestamp: Date.now() });
      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
  },

  async getImage(id: string): Promise<string | null> {
    try {
      const db = await this.init();
      return await new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        transaction.onerror = () => {
          warnMissingImage(id, transaction.error);
          resolve(null);
        };
        transaction.onabort = () => {
          warnMissingImage(id, transaction.error);
          resolve(null);
        };

        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
          const data = request.result?.data;
          resolve(typeof data === "string" && data ? data : null);
        };
        request.onerror = () => {
          warnMissingImage(id, request.error);
          resolve(null);
        };
      });
    } catch (error) {
      warnMissingImage(id, error);
      return null;
    }
  },
};
