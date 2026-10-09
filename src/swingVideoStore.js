export const MAX_VIDEOS = 10;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const DB_NAME = 'course-corrector-videos';
const STORE = 'videos';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Local video storage is unavailable in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other Course Corrector tabs and retry storage.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

async function transact(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let result;
      let failure;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || transaction.error || new Error('Video storage failed.'));
      action(transaction.objectStore(STORE), (value) => { result = value; }, (error) => {
        failure = error;
        transaction.abort();
      });
    });
  } finally {
    db.close();
  }
}

export function listVideos() {
  return transact('readonly', (store, done) => {
    store.getAll().onsuccess = (event) => done(event.target.result.sort((a, b) => b.createdAt - a.createdAt));
  });
}

export function saveVideo(video) {
  if (!(video.blob instanceof Blob) || !video.blob.size) {
    return Promise.reject(new Error('The camera produced an empty video. Please record again.'));
  }
  if (video.blob.size > MAX_VIDEO_BYTES) {
    return Promise.reject(new Error('This video exceeds the 25 MB clip limit. Download it to keep a copy.'));
  }
  return transact('readwrite', (store, done, fail) => {
    // The count and write share a transaction, including across browser tabs.
    store.count().onsuccess = (event) => {
      if (event.target.result >= MAX_VIDEOS) {
        fail(new Error('All 10 video slots are full. Delete a saved video, then retry saving.'));
        return;
      }
      store.add(video).onsuccess = () => done(video);
    };
  });
}

export function deleteVideo(id) {
  return transact('readwrite', (store) => { store.delete(id); });
}
