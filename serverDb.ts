/**
 * serverDb.ts — Server-side Firestore access layer.
 *
 * Prefers the Firebase **Admin SDK** (service account / Application Default
 * Credentials), which bypasses Firestore security rules — the correct, secure
 * production path. The server can then read protected collections and persist the
 * WhatsApp session WITHOUT the database having to be world-writable.
 *
 * If admin credentials are not available (e.g. local dev without ADC), it falls
 * back to the unauthenticated **client SDK** so the app keeps working exactly as
 * before. The active mode is logged loudly at startup.
 *
 * Configure admin credentials with EITHER:
 *   - GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json  (file), or
 *   - FIREBASE_SERVICE_ACCOUNT_JSON='{...}'                          (inline JSON), or
 *   - nothing on Cloud Run / GCP, where ADC is provided automatically.
 */
import fs from 'fs';
import { randomUUID } from 'crypto';
import { normalizePhone } from './src/lib/phone';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const databaseId: string = firebaseConfig.firestoreDatabaseId;

export interface RecruiterIdentity {
  uid: string;
  email: string | null;
  isRecruiter: boolean;
  isAdmin: boolean;
}

export interface ServerDb {
  mode: 'admin' | 'client';
  /** True only when the server can cryptographically verify Firebase ID tokens. */
  canEnforceAuth: boolean;
  getDocData(collection: string, id: string): Promise<any | null>;
  setDocData(collection: string, id: string, data: Record<string, any>): Promise<void>;
  /** Atomically creates/updates a candidate + application in a single batch. */
  applyBatch(candidate: { id: string; data: Record<string, any> }, application: { id: string; data: Record<string, any> }): Promise<void>;
  /** First candidate id whose normalized phone OR email matches (for dedup). */
  findCandidateIdByPhoneOrEmail(phoneNormalized: string, email: string): Promise<string | null>;
  deleteDocData(collection: string, id: string): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  findCandidateIdByPhone(phone: string): Promise<string | null>;
  /** Adds a whatsapp_messages doc, stamping `sentAt` with the server time. */
  addWhatsappMessage(data: Record<string, any>): Promise<void>;
  /** Verifies a Firebase ID token and resolves the caller's recruiter/admin status. Admin mode only. */
  verifyRecruiter(idToken: string): Promise<RecruiterIdentity | null>;
  /** Verifies a Firebase ID token (incl. anonymous) and returns its uid, or null. Admin mode only. */
  verifyUid(idToken: string): Promise<string | null>;
  /** Candidates awaiting AI CV analysis (aiStatus == 'pending'). */
  listPendingCandidates(max: number): Promise<Array<{ id: string; cvUrl?: string; cvFileType?: string; fullName?: string }>>;
  /** Atomically claims a candidate for processing (pending -> processing). Returns false if already claimed. */
  claimCandidate(id: string): Promise<boolean>;
  /** Returns candidates stuck in 'processing' (older than olderThanMs) to 'pending'. Returns count reclaimed. */
  reclaimStuckProcessing(olderThanMs: number): Promise<number>;
  /** Ids of all applications for a candidate. */
  getApplicationIdsByCandidate(candidateId: string): Promise<string[]>;
  /** Uploads a publicly-readable file to Cloud Storage and returns its download URL. Admin mode only. */
  uploadPublicFile(path: string, buffer: Buffer, contentType: string): Promise<string>;
  /** Active (published) vacancies, for the public careers portal. */
  listActiveVacancies(): Promise<any[]>;

  // --- WhatsApp single-owner lease + durable outbox (admin mode only) -------------
  /** True when the durable WhatsApp outbox is available (Admin SDK present). */
  supportsOutbox: boolean;
  /** Atomically claims/renews the "who owns the WhatsApp socket" lease. Returns true
   * if `holderId` now holds it. `force` steals it regardless of the current holder
   * (the recruiter's reconnect button is the human override). */
  acquireWhatsAppLease(holderId: string, ttlMs: number, force?: boolean): Promise<boolean>;
  /** Releases the lease if held by `holderId` (clean handover on shutdown). */
  releaseWhatsAppLease(holderId: string): Promise<void>;
  /** Persists an outgoing message. Returns its outbox id. */
  enqueueWhatsApp(data: Record<string, any>): Promise<string>;
  /** Queued messages whose nextAttemptAt has passed, oldest first. */
  listOutboxSendable(max: number): Promise<any[]>;
  /** Atomically claims one outbox message (queued -> sending). False if already taken. */
  claimOutboxMessage(id: string): Promise<boolean>;
  /** Merges fields into an outbox message (status flips, attempts, errors). */
  markOutbox(id: string, fields: Record<string, any>): Promise<void>;
  /** Returns messages stuck in 'sending' (older than ms) to 'queued'. */
  reclaimStuckOutbox(olderThanMs: number): Promise<number>;
  /** How many messages are waiting (queued or sending). */
  countOutboxPending(): Promise<number>;
  /** One outbox message by id (to report the final state of a manual send). */
  getOutboxMessage(id: string): Promise<any | null>;
}

// Kept in sync with firestore.rules / AuthContext.
const ADMIN_EMAILS = ['daruingmejia@gmail.com'];

function resolveRoles(email: string | null, roleIds: string[]): { isRecruiter: boolean; isAdmin: boolean } {
  const lower = (email || '').toLowerCase();
  const isAdmin = roleIds.includes('admin') || ADMIN_EMAILS.includes(lower);
  const isRecruiter = isAdmin || roleIds.includes('recruiter');
  return { isRecruiter, isAdmin };
}

// ---------------------------------------------------------------------------
// Admin backend
// ---------------------------------------------------------------------------
async function tryInitAdmin(): Promise<ServerDb | null> {
  try {
    const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const { getAuth } = await import('firebase-admin/auth');
    const { getStorage } = await import('firebase-admin/storage');

    let credential: any;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    } else {
      credential = applicationDefault();
    }

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential, projectId: firebaseConfig.projectId });

    const adb = getFirestore(app, databaseId);
    const auth = getAuth(app);

    // Connectivity probe: confirms the credential actually works before we commit
    // to admin mode (applicationDefault() does not fail until first use).
    await adb.collection('settings').limit(1).get();

    return {
      mode: 'admin',
      canEnforceAuth: true,
      async getDocData(collection, id) {
        const snap = await adb.collection(collection).doc(id).get();
        return snap.exists ? snap.data() : null;
      },
      async setDocData(collection, id, data) {
        await adb.collection(collection).doc(id).set(data, { merge: true });
      },
      async applyBatch(candidate, application) {
        const batch = adb.batch();
        batch.set(adb.collection('candidates').doc(candidate.id), candidate.data, { merge: true });
        batch.set(adb.collection('applications').doc(application.id), application.data, { merge: true });
        await batch.commit();
      },
      async findCandidateIdByPhoneOrEmail(phoneNormalized, email) {
        if (phoneNormalized) {
          const s = await adb.collection('candidates').where('phoneNormalized', '==', phoneNormalized).limit(1).get();
          if (!s.empty) return s.docs[0].id;
        }
        if (email) {
          const s = await adb.collection('candidates').where('email', '==', email).limit(1).get();
          if (!s.empty) return s.docs[0].id;
        }
        return null;
      },
      async deleteDocData(collection, id) {
        await adb.collection(collection).doc(id).delete();
      },
      async deleteCollection(collection) {
        const snap = await adb.collection(collection).get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));
      },
      async findCandidateIdByPhone(phone) {
        const norm = normalizePhone(phone);
        // Primary match: the canonical field written at intake / CV parse.
        let snap = await adb.collection('candidates').where('phoneNormalized', '==', norm).limit(1).get();
        if (!snap.empty) return snap.docs[0].id;
        // Fallback for legacy candidates without phoneNormalized: try common raw forms.
        const variants = Array.from(new Set([norm, String(phone || ''), norm.startsWith('1') ? norm.slice(1) : norm].filter(Boolean)));
        for (const v of variants) {
          snap = await adb.collection('candidates').where('phone', '==', v).limit(1).get();
          if (!snap.empty) return snap.docs[0].id;
        }
        return null;
      },
      async addWhatsappMessage(data) {
        await adb.collection('whatsapp_messages').add({ ...data, sentAt: FieldValue.serverTimestamp() });
      },
      async listPendingCandidates(max) {
        const snap = await adb.collection('candidates').where('aiStatus', '==', 'pending').limit(max).get();
        return snap.docs.map((d: any) => ({ id: d.id, cvUrl: d.data().cvUrl, cvFileType: d.data().cvFileType, fullName: d.data().fullName }));
      },
      async claimCandidate(id) {
        const ref = adb.collection('candidates').doc(id);
        return await adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data()?.aiStatus !== 'pending') return false;
          tx.update(ref, { aiStatus: 'processing', processingStartedAt: new Date() });
          return true;
        });
      },
      async reclaimStuckProcessing(olderThanMs) {
        // Single-field query (auto-indexed); filter the age in memory to avoid a
        // composite index. A crash/restart between claim and completion would
        // otherwise strand a candidate in 'processing' forever.
        const snap = await adb.collection('candidates').where('aiStatus', '==', 'processing').limit(50).get();
        const cutoffMs = Date.now() - olderThanMs;
        let n = 0;
        for (const d of snap.docs) {
          const started: any = d.data()?.processingStartedAt;
          const startedMs = started?.toMillis ? started.toMillis() : (started ? new Date(started).getTime() : 0);
          if (!startedMs || startedMs < cutoffMs) {
            await d.ref.update({ aiStatus: 'pending' });
            n++;
          }
        }
        return n;
      },
      async getApplicationIdsByCandidate(candidateId) {
        const snap = await adb.collection('applications').where('candidateId', '==', candidateId).get();
        return snap.docs.map((d: any) => d.id);
      },
      supportsOutbox: true,
      async acquireWhatsAppLease(holderId, ttlMs, force = false) {
        const ref = adb.collection('whatsapp_runtime').doc('socket_owner');
        return await adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          const now = Date.now();
          const cur = snap.exists ? snap.data() : null;
          const curExpires = cur?.expiresAt?.toMillis ? cur.expiresAt.toMillis() : (cur?.expiresAt ? new Date(cur.expiresAt).getTime() : 0);
          const held = cur && cur.holderId && curExpires > now;
          if (held && cur.holderId !== holderId && !force) return false;
          tx.set(ref, { holderId, acquiredAt: cur?.holderId === holderId ? (cur.acquiredAt ?? new Date()) : new Date(), expiresAt: new Date(now + ttlMs) });
          return true;
        });
      },
      async releaseWhatsAppLease(holderId) {
        const ref = adb.collection('whatsapp_runtime').doc('socket_owner');
        await adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          if (snap.exists && snap.data()?.holderId === holderId) tx.delete(ref);
        });
      },
      async enqueueWhatsApp(data) {
        const ref = await adb.collection('whatsapp_outbox').add({ ...data, createdAt: FieldValue.serverTimestamp() });
        return ref.id;
      },
      async listOutboxSendable(max) {
        // Single-field query (auto-indexed); the nextAttemptAt gate is filtered in
        // memory to avoid a composite index — same pattern as reclaimStuckProcessing.
        const snap = await adb.collection('whatsapp_outbox').where('status', '==', 'queued').limit(Math.max(max * 3, 30)).get();
        const now = Date.now();
        const ms = (v: any) => (v?.toMillis ? v.toMillis() : (v ? new Date(v).getTime() : 0));
        return snap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((m: any) => ms(m.nextAttemptAt) <= now)
          .sort((a: any, b: any) => ms(a.createdAt) - ms(b.createdAt))
          .slice(0, max);
      },
      async claimOutboxMessage(id) {
        const ref = adb.collection('whatsapp_outbox').doc(id);
        return await adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data()?.status !== 'queued') return false;
          tx.update(ref, { status: 'sending', sendingStartedAt: new Date() });
          return true;
        });
      },
      async markOutbox(id, fields) {
        await adb.collection('whatsapp_outbox').doc(id).set(fields, { merge: true });
      },
      async reclaimStuckOutbox(olderThanMs) {
        const snap = await adb.collection('whatsapp_outbox').where('status', '==', 'sending').limit(50).get();
        const cutoff = Date.now() - olderThanMs;
        let n = 0;
        for (const d of snap.docs) {
          const started: any = d.data()?.sendingStartedAt;
          const ms = started?.toMillis ? started.toMillis() : (started ? new Date(started).getTime() : 0);
          if (!ms || ms < cutoff) { await d.ref.update({ status: 'queued' }); n++; }
        }
        return n;
      },
      async countOutboxPending() {
        const q = await adb.collection('whatsapp_outbox').where('status', 'in', ['queued', 'sending']).count().get();
        return q.data().count as number;
      },
      async getOutboxMessage(id) {
        const snap = await adb.collection('whatsapp_outbox').doc(id).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
      },
      async listActiveVacancies() {
        const snap = await adb.collection('vacancies').where('active', '==', true).get();
        return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      },
      async uploadPublicFile(path, buffer, contentType) {
        const bucket = getStorage(app).bucket(firebaseConfig.storageBucket);
        const token = randomUUID();
        await bucket.file(path).save(buffer, {
          contentType,
          resumable: false,
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const encoded = encodeURIComponent(path);
        return `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encoded}?alt=media&token=${token}`;
      },
      async verifyUid(idToken) {
        try {
          const decoded = await auth.verifyIdToken(idToken);
          return decoded.uid || null;
        } catch {
          return null;
        }
      },
      async verifyRecruiter(idToken) {
        const decoded = await auth.verifyIdToken(idToken);
        const email = decoded.email || null;
        const userSnap = await adb.collection('users').doc(decoded.uid).get();
        const roleIds: string[] = userSnap.exists && Array.isArray(userSnap.data()?.roleIds)
          ? userSnap.data()!.roleIds
          : [];
        const { isRecruiter, isAdmin } = resolveRoles(email, roleIds);
        return { uid: decoded.uid, email, isRecruiter, isAdmin };
      },
    };
  } catch (err: any) {
    console.warn('[serverDb] Admin SDK unavailable, falling back to client SDK:', err?.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Client backend (fallback — unauthenticated, relies on permissive rules)
// ---------------------------------------------------------------------------
async function initClient(): Promise<ServerDb> {
  const { initializeApp } = await import('firebase/app');
  const {
    initializeFirestore, collection, query, where, limit, getDocs, addDoc,
    serverTimestamp, doc, getDoc, setDoc, deleteDoc, writeBatch,
  } = await import('firebase/firestore');

  const app = initializeApp(firebaseConfig, 'server-client-fallback');
  const cdb = initializeFirestore(app, { experimentalForceLongPolling: true }, databaseId);

  return {
    mode: 'client',
    canEnforceAuth: false,
    async getDocData(c, id) {
      const snap = await getDoc(doc(cdb, c, id));
      return snap.exists() ? snap.data() : null;
    },
    async setDocData(c, id, data) {
      await setDoc(doc(cdb, c, id), data, { merge: true });
    },
    async applyBatch(candidate, application) {
      const batch = writeBatch(cdb);
      batch.set(doc(cdb, 'candidates', candidate.id), candidate.data, { merge: true });
      batch.set(doc(cdb, 'applications', application.id), application.data, { merge: true });
      await batch.commit();
    },
    async findCandidateIdByPhoneOrEmail(phoneNormalized, email) {
      if (phoneNormalized) {
        const s = await getDocs(query(collection(cdb, 'candidates'), where('phoneNormalized', '==', phoneNormalized), limit(1)));
        if (!s.empty) return s.docs[0].id;
      }
      if (email) {
        const s = await getDocs(query(collection(cdb, 'candidates'), where('email', '==', email), limit(1)));
        if (!s.empty) return s.docs[0].id;
      }
      return null;
    },
    async deleteDocData(c, id) {
      await deleteDoc(doc(cdb, c, id));
    },
    async deleteCollection(c) {
      const snap = await getDocs(collection(cdb, c));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    },
    async findCandidateIdByPhone(phone) {
      const norm = normalizePhone(phone);
      let snap = await getDocs(query(collection(cdb, 'candidates'), where('phoneNormalized', '==', norm), limit(1)));
      if (!snap.empty) return snap.docs[0].id;
      const variants = Array.from(new Set([norm, String(phone || ''), norm.startsWith('1') ? norm.slice(1) : norm].filter(Boolean)));
      for (const v of variants) {
        snap = await getDocs(query(collection(cdb, 'candidates'), where('phone', '==', v), limit(1)));
        if (!snap.empty) return snap.docs[0].id;
      }
      return null;
    },
    async addWhatsappMessage(data) {
      await addDoc(collection(cdb, 'whatsapp_messages'), { ...data, sentAt: serverTimestamp() });
    },
    async listPendingCandidates(max) {
      const snap = await getDocs(query(collection(cdb, 'candidates'), where('aiStatus', '==', 'pending'), limit(max)));
      return snap.docs.map(d => ({ id: d.id, cvUrl: d.data().cvUrl, cvFileType: d.data().cvFileType, fullName: d.data().fullName }));
    },
    async claimCandidate(id) {
      const ref = doc(cdb, 'candidates', id);
      const snap = await getDoc(ref);
      if (!snap.exists() || snap.data()?.aiStatus !== 'pending') return false;
      await setDoc(ref, { aiStatus: 'processing', processingStartedAt: new Date() }, { merge: true });
      return true;
    },
    async reclaimStuckProcessing(olderThanMs) {
      const snap = await getDocs(query(collection(cdb, 'candidates'), where('aiStatus', '==', 'processing'), limit(50)));
      const cutoffMs = Date.now() - olderThanMs;
      let n = 0;
      for (const d of snap.docs) {
        const started: any = d.data()?.processingStartedAt;
        const startedMs = started?.toMillis ? started.toMillis() : (started ? new Date(started).getTime() : 0);
        if (!startedMs || startedMs < cutoffMs) {
          await setDoc(d.ref, { aiStatus: 'pending' }, { merge: true });
          n++;
        }
      }
      return n;
    },
    async getApplicationIdsByCandidate(candidateId) {
      const snap = await getDocs(query(collection(cdb, 'applications'), where('candidateId', '==', candidateId)));
      return snap.docs.map(d => d.id);
    },
    // Dev fallback: no Admin SDK, so no durable outbox (the rules block client access
    // to whatsapp_outbox on purpose). The server falls back to direct sends, and the
    // single local process trivially "owns" the socket.
    supportsOutbox: false,
    async acquireWhatsAppLease() { return true; },
    async releaseWhatsAppLease() { /* no-op */ },
    async enqueueWhatsApp() { throw new Error('outbox_no_disponible_en_dev'); },
    async listOutboxSendable() { return []; },
    async claimOutboxMessage() { return false; },
    async markOutbox() { /* no-op */ },
    async reclaimStuckOutbox() { return 0; },
    async countOutboxPending() { return 0; },
    async getOutboxMessage() { return null; },
    async listActiveVacancies() {
      const snap = await getDocs(query(collection(cdb, 'vacancies'), where('active', '==', true)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async uploadPublicFile() {
      throw new Error('uploadPublicFile requires admin mode (no admin credentials configured).');
    },
    async verifyUid() {
      // The client SDK cannot verify ID tokens.
      return null;
    },
    async verifyRecruiter() {
      // The client SDK cannot verify ID tokens. Auth enforcement is disabled in this mode.
      return null;
    },
  };
}

let cached: ServerDb | null = null;

export async function getServerDb(): Promise<ServerDb> {
  if (cached) return cached;
  const admin = await tryInitAdmin();
  cached = admin || (await initClient());
  if (cached.mode === 'admin') {
    console.log('[serverDb] Firestore: ADMIN mode (security rules bypassed, auth enforcement ENABLED).');
  } else {
    console.warn('[serverDb] Firestore: CLIENT fallback mode (no admin credentials; API auth NOT enforced). ' +
      'Provide GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON to enable secure mode.');
  }
  return cached;
}
