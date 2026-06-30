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
  deleteDocData(collection: string, id: string): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  findCandidateIdByPhone(phone: string): Promise<string | null>;
  /** Adds a whatsapp_messages doc, stamping `sentAt` with the server time. */
  addWhatsappMessage(data: Record<string, any>): Promise<void>;
  /** Verifies a Firebase ID token and resolves the caller's recruiter/admin status. Admin mode only. */
  verifyRecruiter(idToken: string): Promise<RecruiterIdentity | null>;
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
      async deleteDocData(collection, id) {
        await adb.collection(collection).doc(id).delete();
      },
      async deleteCollection(collection) {
        const snap = await adb.collection(collection).get();
        await Promise.all(snap.docs.map(d => d.ref.delete()));
      },
      async findCandidateIdByPhone(phone) {
        const snap = await adb.collection('candidates').where('phone', '==', phone).limit(1).get();
        return snap.empty ? null : snap.docs[0].id;
      },
      async addWhatsappMessage(data) {
        await adb.collection('whatsapp_messages').add({ ...data, sentAt: FieldValue.serverTimestamp() });
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
    serverTimestamp, doc, getDoc, setDoc, deleteDoc,
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
    async deleteDocData(c, id) {
      await deleteDoc(doc(cdb, c, id));
    },
    async deleteCollection(c) {
      const snap = await getDocs(collection(cdb, c));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    },
    async findCandidateIdByPhone(phone) {
      const snap = await getDocs(query(collection(cdb, 'candidates'), where('phone', '==', phone), limit(1)));
      return snap.empty ? null : snap.docs[0].id;
    },
    async addWhatsappMessage(data) {
      await addDoc(collection(cdb, 'whatsapp_messages'), { ...data, sentAt: serverTimestamp() });
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
