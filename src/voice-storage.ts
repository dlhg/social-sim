/**
 * Voice Storage — persists cloned voice audio in IndexedDB so voices
 * survive TTS server restarts and dev reloads.
 *
 * On app startup, any locally-stored voices missing from the server
 * are automatically re-uploaded.
 */

const DB_NAME = "npc-playground-voices";
const DB_VERSION = 1;
const STORE_NAME = "voice-clips";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Store a voice clip locally. */
export async function storeVoice(voiceId: string, audio: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(audio, voiceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Retrieve a stored voice clip. */
export async function getStoredVoice(voiceId: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(voiceId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a stored voice clip. */
export async function deleteStoredVoice(voiceId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(voiceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** List all locally-stored voice IDs. */
export async function getAllStoredVoiceIds(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Sync locally-stored voices to the TTS server.
 * Re-uploads any voices that exist locally but are missing on the server.
 */
export async function syncVoicesToServer(
  serverVoiceIds: string[],
  uploadFn: (blob: Blob, voiceId: string) => Promise<unknown>,
): Promise<number> {
  let synced = 0;
  try {
    const localIds = await getAllStoredVoiceIds();
    const serverSet = new Set(serverVoiceIds);
    for (const id of localIds) {
      if (!serverSet.has(id)) {
        const blob = await getStoredVoice(id);
        if (blob) {
          const result = await uploadFn(blob, id);
          if (result) {
            synced++;
            console.log(`[voice-storage] re-uploaded ${id} to server`);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[voice-storage] sync error:", err);
  }
  return synced;
}
