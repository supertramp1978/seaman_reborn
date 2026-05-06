const DB_NAME    = 'seaman_memory';
const DB_VERSION = 1;

let _dbPromise = null;

function _getDB() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('conversations')) {
          const convs = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
          convs.createIndex('timestamp',  'timestamp',  { unique: false });
          convs.createIndex('turn_index', 'turn_index', { unique: true  });
        }

        if (!db.objectStoreNames.contains('facts')) {
          const facts = db.createObjectStore('facts', { keyPath: 'id', autoIncrement: true });
          facts.createIndex('subject', 'subject', { unique: true });
        }
      };

      req.onsuccess  = (e) => resolve(e.target.result);
      req.onerror    = (e) => reject(e.target.error);
    });
  }
  return _dbPromise;
}

function _wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function openDB() {
  return _getDB();
}

// ── conversations ──────────────────────────────────────────────────────────

export async function saveConversation({ user_text, assistant_text, user_embedding, turn_index }) {
  const db = await _getDB();
  return _wrap(
    db.transaction('conversations', 'readwrite')
      .objectStore('conversations')
      .add({ user_text, assistant_text, user_embedding, turn_index, timestamp: new Date().toISOString() }),
  );
}

export async function getAllConversations() {
  const db = await _getDB();
  return _wrap(
    db.transaction('conversations', 'readonly')
      .objectStore('conversations')
      .getAll(),
  );
}

export async function getRecentConversations(limit = 10) {
  const all = await getAllConversations();
  return all.slice(-limit);
}

export async function getNextTurnIndex() {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('conversations', 'readonly')
      .objectStore('conversations')
      .index('turn_index')
      .openCursor(null, 'prev');
    req.onsuccess = (e) => resolve(e.target.result ? e.target.result.value.turn_index + 1 : 1);
    req.onerror   = () => reject(req.error);
  });
}

// ── facts ──────────────────────────────────────────────────────────────────

export async function getFact(subject) {
  const db = await _getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('facts', 'readonly')
      .objectStore('facts')
      .index('subject')
      .get(subject);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

export async function getFacts() {
  const db = await _getDB();
  return _wrap(
    db.transaction('facts', 'readonly')
      .objectStore('facts')
      .getAll(),
  );
}

export async function saveFact({ subject, value, confidence, source_turn_id }) {
  const db   = await _getDB();
  const existing = await getFact(subject);
  const record = { subject, value, confidence, source_turn_id, timestamp: new Date().toISOString() };
  if (existing) record.id = existing.id; // upsert: keep same id for put
  return _wrap(
    db.transaction('facts', 'readwrite')
      .objectStore('facts')
      .put(record),
  );
}

// ── debug ──────────────────────────────────────────────────────────────────

export async function wipeDB() {
  _dbPromise = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
