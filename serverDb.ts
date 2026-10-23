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
  /**
   * TODOS los candidatos cuyo teléfono o correo coincide (principal o alternativo), como
   * [{id, ...datos}]. `findCandidateIdByPhoneOrEmail` devuelve uno ARBITRARIO (limit 1),
   * y eso no sirve para decidir identidad: si una familia comparte el celular, el que
   * vuelve puede no ser el que devuelve la consulta. Quien decide necesita verlos todos.
   *
   * `phone` entra TAL CUAL lo escribió la persona: aquí se prueban sus variantes
   * (canónica, cruda y sin el 1 del país), porque los perfiles viejos y los de subida
   * masiva pueden no tener `phoneNormalized`. Del correo se prueban la forma escrita y
   * la minúscula; Firestore no sabe comparar sin distinguir mayúsculas, así que un
   * tercer uso de mayúsculas distinto se escapa y lo recoge "Revisar duplicados".
   */
  listCandidatesByPhoneOrEmail(phone: string, email: string, max: number): Promise<any[]>;
  /**
   * Escribe en un candidato SOLO si su `cvUrl` sigue siendo el que se leyó; devuelve
   * false si cambió entre medias. Leer un CV tarda decenas de segundos y la persona
   * puede volver a aplicar con otro en ese rato: comparar y escribir por separado deja
   * una ventana en la que esta lectura pisa la cola del CV nuevo, que ya no se leería
   * nunca. En modo admin es una transacción; en modo cliente, una transacción del SDK.
   */
  writeCandidateIfCvUnchanged(id: string, expectedCvUrl: string | null | undefined, data: Record<string, any>): Promise<boolean>;
  /**
   * Rellena el teléfono canónico de un candidato si le falta, DERIVÁNDOLO del teléfono
   * que el documento tiene en ese instante, dentro de una transacción. Devuelve si lo
   * escribió.
   *
   * Lo que se leyó en un recorrido de la colección puede estar viejo: si el equipo le
   * cambió el teléfono entre medias, escribir la forma canónica del anterior dejaría el
   * perfil diciendo dos cosas distintas — y de `phoneNormalized` depende a quién se
   * enlaza un WhatsApp entrante. Así que el recorrido solo sirve para elegir a quién
   * mirar; el valor sale del documento vivo.
   */
  fillMissingPhoneNormalized(id: string): Promise<boolean>;
  deleteDocData(collection: string, id: string): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  findCandidateIdByPhone(phone: string): Promise<string | null>;
  /** Adds a whatsapp_messages doc, stamping `sentAt` with the server time. */
  addWhatsappMessage(data: Record<string, any>): Promise<void>;
  /** Verifies a Firebase ID token and resolves the caller's recruiter/admin status. Admin mode only. */
  verifyRecruiter(idToken: string): Promise<RecruiterIdentity | null>;
  /** Verifies a Firebase ID token (incl. anonymous) and returns its uid, or null. Admin mode only. */
  verifyUid(idToken: string): Promise<string | null>;
  /** Candidates awaiting AI CV analysis (aiStatus == 'pending'). Includes the contact
   * fields so the worker can fill only the EMPTY ones (manual data always wins). */
  listPendingCandidates(max: number): Promise<Array<{ id: string; cvUrl?: string; cvFileType?: string; fullName?: string; email?: string; phone?: string; city?: string; source?: string }>>;
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
  /** Docs whose `field` equals `value` (single-field index), as [{id, ...data}]. */
  listDocsByField(collection: string, field: string, value: unknown, max: number): Promise<any[]>;
  /** Whole collection as [{id, ...data}], optionally only some fields (server-side projection). */
  listDocs(collection: string, fields?: string[]): Promise<any[]>;

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
  /** Atomically retires a message that is STILL queued: 'dismissed' (silently replaced or
   * discarded) or 'failed' (visible, can be retried), with the reason. False if it already
   * left the queue (claimed, sent…): then it goes out as usual. */
  retireOutboxIfQueued(id: string, status: 'dismissed' | 'failed', reason: string): Promise<boolean>;
  /** Discards (-> dismissed) every queued message that entered the queue before the cutoff.
   * Returns how many. */
  retireQueuedOutboxBefore(cutoffMs: number, reason: string): Promise<number>;
  /** Merges fields into an outbox message (status flips, attempts, errors). */
  markOutbox(id: string, fields: Record<string, any>): Promise<void>;
  /** Returns messages stuck in 'sending' (older than ms) to 'queued'. */
  reclaimStuckOutbox(olderThanMs: number): Promise<number>;
  /** How many messages are waiting (queued or sending). */
  countOutboxPending(): Promise<number>;
  /** One outbox message by id (to report the final state of a manual send). */
  getOutboxMessage(id: string): Promise<any | null>;
  /** Recent outbox docs for a phone, any status (dedupe decisions happen in the caller). */
  listOutboxByPhone(phone: string): Promise<any[]>;
  /** Outbox docs in any of the given statuses (queue viewer). Unsorted; caller sorts. */
  listOutboxByStatuses(statuses: string[], max: number): Promise<any[]>;
  /** Queued MANUAL messages ready to send. The quarantine drain reads these directly:
   * fetching the generic queue and filtering afterwards let ≥30 queued automations
   * occupy the whole batch window and starve the recruiter's own chat for hours. */
  listQueuedOutboxManual(max: number): Promise<any[]>;
  /** The most recently SENT messages, newest first (side panel "Enviados"). */
  listOutboxRecentlySent(max: number): Promise<any[]>;
  /** The most recently FAILED messages still marked failed, newest first. Ordered by
   * failedAt; failures recorded before that field existed are stamped once by
   * backfillOutboxFailedAt(). */
  listOutboxRecentlyFailed(max: number): Promise<any[]>;
  /** One-time: gives legacy failed messages a failedAt so they sort. Returns how many. */
  backfillOutboxFailedAt(): Promise<number>;
  /** The outbox message a WhatsApp message id belongs to (delivery/read receipts). */
  findOutboxIdByWaMessageId(waMessageId: string): Promise<string | null>;
  /** Bumped by every outbox write made through this process. Lets the side panel's
   * snapshot be served from memory while nothing changed (Firestore reads cost quota). */
  outboxVersion(): number;
}

// Kept in sync with firestore.rules / AuthContext.
const ADMIN_EMAILS = ['daruingmejia@gmail.com'];

function resolveRoles(email: string | null, roleIds: string[]): { isRecruiter: boolean; isAdmin: boolean } {
  const lower = (email || '').toLowerCase();
  const isAdmin = roleIds.includes('admin') || ADMIN_EMAILS.includes(lower);
  const isRecruiter = isAdmin || roleIds.includes('recruiter');
  return { isRecruiter, isAdmin };
}

/**
 * Las consultas con las que se busca a una persona por su contacto, en orden: primero
 * las que más rinden (el campo canónico), luego las variantes que cubren los perfiles
 * viejos y los de subida masiva, que pueden no tener `phoneNormalized` y guardan el
 * teléfono como lo escribió alguien.
 *
 * Es exactamente lo que `isSameApplicant` normaliza al comparar: si la búsqueda no
 * encuentra el perfil, esa comparación nunca llega a hacerse y la persona se duplica.
 */
export function contactLookupAttempts(phone: unknown, email: unknown): Array<[string, string, string]> {
  const norm = normalizePhone(String(phone || ''));
  const raw = String(phone || '').trim();
  const phones = Array.from(new Set([norm, raw, norm.startsWith('1') ? norm.slice(1) : norm].filter(Boolean)));
  const written = String(email || '').trim();
  const emails = Array.from(new Set([written, written.toLowerCase()].filter(Boolean)));

  const attempts: Array<[string, string, string]> = [];
  phones.forEach(p => attempts.push(['phoneNormalized', '==', p]));
  emails.forEach(e => attempts.push(['email', '==', e]));
  phones.forEach(p => attempts.push(['phone', '==', p], ['alternatePhones', 'array-contains', p]));
  emails.forEach(e => attempts.push(['alternateEmails', 'array-contains', e]));
  return attempts;
}

/**
 * La consulta que de verdad IDENTIFICA: teléfono y correo a la vez, que es lo que exige
 * `isSameApplicant`.
 *
 * Las consultas por un solo campo tienen que llevar tope —si no, un número de negocio
 * compartido haría leer la base entera en cada postulación, y eso lo puede provocar
 * cualquiera desde el formulario público— y un tope siempre deja fuera al perfil número
 * once. Buscando los dos datos juntos eso deja de importar: devuelve a quien coincide en
 * ambos, por muchos que compartan uno de los dos. Firestore resuelve varias igualdades
 * con sus índices de un solo campo, sin índice compuesto.
 *
 * El correo se prueba escrito y en minúsculas porque Firestore compara exacto; el
 * teléfono, en su forma canónica, que es la que todos los caminos de escritura guardan
 * (y la que el relleno pone en los perfiles viejos).
 */
export function exactContactLookups(phone: unknown, email: unknown): Array<Array<[string, string, string]>> {
  const norm = normalizePhone(String(phone || ''));
  const written = String(email || '').trim();
  if (!norm || !written) return [];
  const emails = Array.from(new Set([written, written.toLowerCase()]));
  return emails.map(e => [
    ['phoneNormalized', '==', norm] as [string, string, string],
    ['email', '==', e] as [string, string, string],
  ]);
}

/**
 * A qué dato de contacto pertenece una consulta: al teléfono o al correo.
 *
 * La búsqueda tiene que agotar las DOS dimensiones. Si se corta al juntar suficientes
 * resultados y diez perfiles comparten el teléfono (un número de negocio, una familia
 * grande), las consultas del correo no llegan a ejecutarse — y el perfil que sí es esta
 * persona puede estar fuera de ese grupo arbitrario de diez.
 */
export function lookupDimension(field: string): 'phone' | 'email' {
  return field.toLowerCase().includes('mail') ? 'email' : 'phone';
}

/**
 * Sigue el rastro de una unificación de perfiles: si el candidato encontrado fue
 * unificado en otro (`mergedInto`), devuelve el id del perfil VIVO.
 *
 * Sin esto, un perfil ya unificado seguiría capturando lo que llega por su teléfono o
 * correo: la respuesta de WhatsApp se guardaría en un perfil que nadie abre, y el
 * deduplicado de /api/apply miraría un perfil sin postulaciones. Hasta 5 saltos, por si
 * alguien unificó A→B y luego B→C; un ciclo corta en seco en vez de colgar el servidor.
 *
 * `strict` decide qué pasa si la lectura FALLA (un fallo pasajero de Firestore). Sin él
 * se sigue adelante y se devuelve el id que se tenía, que es lo que conviene a quien
 * solo quiere ENCONTRAR a alguien: enlazar un WhatsApp al perfil unificado es peor que
 * enlazarlo bien, pero mucho mejor que perder el mensaje. Con él, el fallo se propaga,
 * porque quien va a ESCRIBIR en el perfil que salga de aquí —el intake— no puede tratar
 * un perfil muerto como vivo: la postulación y el CV nacerían colgados de un perfil que
 * nadie abre, invisibles en el vivo. Ahí es mejor fallar y que la persona reintente.
 */
export async function followMergedInto(
  read: (id: string) => Promise<any | null>,
  id: string | null,
  opts?: { strict?: boolean },
): Promise<string | null> {
  let current = id;
  const seen = new Set<string>();
  for (let hop = 0; current && hop < 5; hop++) {
    if (seen.has(current)) return current;
    seen.add(current);
    const data = opts?.strict ? await read(current) : await read(current).catch(() => null);
    const next = data?.mergedInto;
    if (typeof next !== 'string' || !next || next === current) return current;
    current = next;
  }
  return current;
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

    // See outboxVersion() in the interface.
    let outboxVersion = 0;

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
        const readCandidate = async (id: string) => (await adb.collection('candidates').doc(id).get()).data() ?? null;
        // El teléfono/correo con el que nació un perfil duplicado queda guardado al
        // unificarlo. Buscarlo también ahí es lo que evita el TERCER duplicado: la misma
        // persona volviendo a escribir el número con el que ya la conocíamos.
        const attempts: Array<[string, string, unknown]> = [
          ['phoneNormalized', '==', phoneNormalized],
          ['email', '==', email],
          ['alternatePhones', 'array-contains', phoneNormalized],
          ['alternateEmails', 'array-contains', email],
        ];
        for (const [field, op, value] of attempts) {
          if (!value) continue;
          const s = await adb.collection('candidates').where(field, op as any, value).limit(1).get();
          if (!s.empty) return followMergedInto(readCandidate, s.docs[0].id);
        }
        return null;
      },
      async listCandidatesByPhoneOrEmail(phone, email, max) {
        const byId = new Map<string, any>();
        // Primero la consulta precisa —teléfono Y correo— porque es la que identifica y
        // no le afecta cuántos perfiles compartan uno de los dos (ver `exactContactLookups`).
        for (const clause of exactContactLookups(phone, email)) {
          let q: any = adb.collection('candidates');
          clause.forEach(([f, op, v]) => { q = q.where(f, op as any, v); });
          const snap = await q.limit(5).get();
          snap.docs.forEach((d: any) => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() }); });
        }
        // Y después por un solo campo, que es lo que encuentra a quien tiene el dato en
        // otro sitio (los alternativos de una unificación, un teléfono viejo sin forma
        // canónica). El tope es POR DIMENSIÓN, no global (ver `lookupDimension`): cortar
        // al llegar a `max` dejaba sin ejecutar las consultas del correo cuando muchos
        // perfiles comparten el teléfono.
        const found = new Map<string, number>();
        for (const [field, op, value] of contactLookupAttempts(phone, email)) {
          const dim = lookupDimension(field);
          if ((found.get(dim) || 0) >= max) continue;
          const snap = await adb.collection('candidates').where(field, op as any, value).limit(max).get();
          snap.docs.forEach((d: any) => {
            if (byId.has(d.id)) return;
            byId.set(d.id, { id: d.id, ...d.data() });
            found.set(dim, (found.get(dim) || 0) + 1);
          });
        }
        return Array.from(byId.values());
      },
      async fillMissingPhoneNormalized(id) {
        const ref = adb.collection('candidates').doc(id);
        return adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          const c = snap.exists ? snap.data() : null;
          if (!c || c.phoneNormalized) return false;
          const norm = normalizePhone(String(c.phone || ''));
          if (!norm) return false;
          tx.set(ref, { phoneNormalized: norm }, { merge: true });
          return true;
        });
      },
      async writeCandidateIfCvUnchanged(id, expectedCvUrl, data) {
        const ref = adb.collection('candidates').doc(id);
        return adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          const current = snap.exists ? snap.data() : null;
          // Solo manda cuando AMBOS existen: un `cvUrl` vacío en cualquiera de los dos
          // lados no prueba que haya cambiado nada (perfiles sin CV, lecturas sueltas).
          if (current && expectedCvUrl && current.cvUrl && current.cvUrl !== expectedCvUrl) return false;
          tx.set(ref, data, { merge: true });
          return true;
        });
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
        const readCandidate = async (id: string) => (await adb.collection('candidates').doc(id).get()).data() ?? null;
        // Primary match: the canonical field written at intake / CV parse.
        let snap = await adb.collection('candidates').where('phoneNormalized', '==', norm).limit(1).get();
        if (!snap.empty) return followMergedInto(readCandidate, snap.docs[0].id);
        // Fallback for legacy candidates without phoneNormalized: try common raw forms.
        const variants = Array.from(new Set([norm, String(phone || ''), norm.startsWith('1') ? norm.slice(1) : norm].filter(Boolean)));
        for (const v of variants) {
          snap = await adb.collection('candidates').where('phone', '==', v).limit(1).get();
          if (!snap.empty) return followMergedInto(readCandidate, snap.docs[0].id);
        }
        // Un número que quedó guardado como alternativo al unificar dos perfiles sigue
        // siendo esa persona: es justo el número por el que el duplicado nació.
        for (const v of variants) {
          snap = await adb.collection('candidates').where('alternatePhones', 'array-contains', v).limit(1).get();
          if (!snap.empty) return followMergedInto(readCandidate, snap.docs[0].id);
        }
        return null;
      },
      async addWhatsappMessage(data) {
        await adb.collection('whatsapp_messages').add({ ...data, sentAt: FieldValue.serverTimestamp() });
      },
      async listPendingCandidates(max) {
        const snap = await adb.collection('candidates').where('aiStatus', '==', 'pending').limit(max).get();
        return snap.docs.map((d: any) => {
          const c = d.data();
          return { id: d.id, cvUrl: c.cvUrl, cvFileType: c.cvFileType, fullName: c.fullName, email: c.email, phone: c.phone, city: c.city, source: c.source };
        });
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
      outboxVersion: () => outboxVersion,
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
        outboxVersion++;
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
        }).then((claimed: boolean) => { if (claimed) outboxVersion++; return claimed; });
      },
      async retireOutboxIfQueued(id, status, reason) {
        const ref = adb.collection('whatsapp_outbox').doc(id);
        return await adb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data()?.status !== 'queued') return false;
          tx.update(ref, status === 'dismissed'
            ? { status, dismissedAt: new Date(), lastError: reason }
            : { status, nextAttemptAt: null, lastError: reason, failedAt: new Date() });
          return true;
        }).then((retired: boolean) => { if (retired) outboxVersion++; return retired; });
      },
      async retireQueuedOutboxBefore(cutoffMs, reason) {
        // Pages of 'queued' docs (single-field query, no composite index): the old ones in
        // each page are discarded in one batch; stop when a page holds none, or is the last.
        const ms = (v: any) => (v?.toMillis ? v.toMillis() : (v ? new Date(v).getTime() : 0));
        const PAGE = 400;
        let total = 0;
        for (let page = 0; page < 25; page++) {
          const snap = await adb.collection('whatsapp_outbox').where('status', '==', 'queued').limit(PAGE).get();
          const old = snap.docs.filter((d: any) => {
            const queuedAt = Math.max(ms(d.data().createdAt), ms(d.data().requeuedAt));
            return queuedAt > 0 && queuedAt < cutoffMs;
          });
          if (old.length === 0) break;
          const batch = adb.batch();
          for (const d of old) batch.update(d.ref, { status: 'dismissed', dismissedAt: new Date(), lastError: reason });
          await batch.commit();
          outboxVersion++;
          total += old.length;
          if (snap.size < PAGE) break;
        }
        return total;
      },
      async markOutbox(id, fields) {
        await adb.collection('whatsapp_outbox').doc(id).set(fields, { merge: true });
        outboxVersion++;
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
        if (n) outboxVersion++;
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
      async listOutboxByPhone(phone) {
        const snap = await adb.collection('whatsapp_outbox')
          .where('phone', '==', phone).limit(25).get();
        return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      },
      async listOutboxByStatuses(statuses, max) {
        const snap = await adb.collection('whatsapp_outbox')
          .where('status', 'in', statuses).limit(max).get();
        return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      },
      async listQueuedOutboxManual(max) {
        // Two equality filters — served by merging single-field indexes, no composite
        // index needed. nextAttemptAt gated in memory, like listOutboxSendable.
        const snap = await adb.collection('whatsapp_outbox')
          .where('status', '==', 'queued').where('origin', '==', 'manual')
          .limit(Math.max(max * 3, 30)).get();
        const now = Date.now();
        const ms = (v: any) => (v?.toMillis ? v.toMillis() : (v ? new Date(v).getTime() : 0));
        return snap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((m: any) => ms(m.nextAttemptAt) <= now)
          .sort((a: any, b: any) => ms(a.createdAt) - ms(b.createdAt))
          .slice(0, max);
      },
      async listOutboxRecentlySent(max) {
        // Single-field ordering (auto-indexed). Only sent messages carry sentAt, so no
        // status filter (and no composite index) is needed.
        const snap = await adb.collection('whatsapp_outbox').orderBy('sentAt', 'desc').limit(max).get();
        return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      },
      async listOutboxRecentlyFailed(max) {
        // Single-field ordering (auto-indexed). Retried/dismissed messages get failedAt
        // cleared to null, which sorts after every real date — the status filter in
        // memory drops any that still slip in.
        const snap = await adb.collection('whatsapp_outbox').orderBy('failedAt', 'desc').limit(max * 2).get();
        return snap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((m: any) => m.status === 'failed')
          .slice(0, max);
      },
      async backfillOutboxFailedAt() {
        const snap = await adb.collection('whatsapp_outbox').where('status', '==', 'failed').limit(500).get();
        const missing = snap.docs.filter((d: any) => !d.data()?.failedAt);
        for (let i = 0; i < missing.length; i += 400) {
          const batch = adb.batch();
          for (const d of missing.slice(i, i + 400)) {
            const m = d.data() || {};
            // Best guess of WHEN it failed: its last attempt, else when it was queued.
            batch.update(d.ref, { failedAt: m.sendingStartedAt || m.requeuedAt || m.createdAt || new Date() });
          }
          await batch.commit();
        }
        if (missing.length) outboxVersion++;
        return missing.length;
      },
      async findOutboxIdByWaMessageId(waMessageId) {
        const snap = await adb.collection('whatsapp_outbox').where('waMessageId', '==', waMessageId).limit(1).get();
        return snap.empty ? null : snap.docs[0].id;
      },
      async listActiveVacancies() {
        const snap = await adb.collection('vacancies').where('active', '==', true).get();
        return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      },
      async listDocsByField(c, field, value, max) {
        const snap = await adb.collection(c).where(field, '==', value).limit(max).get();
        return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      },
      async listDocs(c, fields) {
        let q: any = adb.collection(c);
        if (fields && fields.length) q = q.select(...fields);
        const snap = await q.get();
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
    serverTimestamp, doc, getDoc, setDoc, deleteDoc, writeBatch, runTransaction,
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
    async fillMissingPhoneNormalized(id) {
      const ref = doc(cdb, 'candidates', id);
      return runTransaction(cdb, async tx => {
        const snap = await tx.get(ref);
        const c = snap.exists() ? (snap.data() as any) : null;
        if (!c || c.phoneNormalized) return false;
        const norm = normalizePhone(String(c.phone || ''));
        if (!norm) return false;
        tx.set(ref, { phoneNormalized: norm }, { merge: true });
        return true;
      });
    },
    async writeCandidateIfCvUnchanged(id, expectedCvUrl, data) {
      const ref = doc(cdb, 'candidates', id);
      return runTransaction(cdb, async tx => {
        const snap = await tx.get(ref);
        const current = snap.exists() ? (snap.data() as any) : null;
        if (current && expectedCvUrl && current.cvUrl && current.cvUrl !== expectedCvUrl) return false;
        tx.set(ref, data, { merge: true });
        return true;
      });
    },
    async findCandidateIdByPhoneOrEmail(phoneNormalized, email) {
      const readCandidate = async (id: string) => {
        const snap = await getDoc(doc(cdb, 'candidates', id));
        return snap.exists() ? snap.data() : null;
      };
      // Ver el modo admin: también por los alternativos que dejó una unificación.
      const attempts: Array<[string, any, unknown]> = [
        ['phoneNormalized', '==', phoneNormalized],
        ['email', '==', email],
        ['alternatePhones', 'array-contains', phoneNormalized],
        ['alternateEmails', 'array-contains', email],
      ];
      for (const [field, op, value] of attempts) {
        if (!value) continue;
        const s = await getDocs(query(collection(cdb, 'candidates'), where(field, op, value), limit(1)));
        if (!s.empty) return followMergedInto(readCandidate, s.docs[0].id);
      }
      return null;
    },
    async listCandidatesByPhoneOrEmail(phone, email, max) {
      const byId = new Map<string, any>();
      // La consulta precisa primero, igual que en modo admin (ver `exactContactLookups`).
      for (const clause of exactContactLookups(phone, email)) {
        const q = query(collection(cdb, 'candidates'), ...clause.map(([f, op, v]) => where(f, op as any, v)), limit(5));
        const snap = await getDocs(q);
        snap.docs.forEach(d => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...(d.data() as any) }); });
      }
      // Tope por dimensión en las de un solo campo (ver `lookupDimension`).
      const found = new Map<string, number>();
      for (const [field, op, value] of contactLookupAttempts(phone, email)) {
        const dim = lookupDimension(field);
        if ((found.get(dim) || 0) >= max) continue;
        const snap = await getDocs(query(collection(cdb, 'candidates'), where(field, op as any, value), limit(max)));
        snap.docs.forEach(d => {
          if (byId.has(d.id)) return;
          byId.set(d.id, { id: d.id, ...(d.data() as any) });
          found.set(dim, (found.get(dim) || 0) + 1);
        });
      }
      // Sin recorte global: dejaría fuera lo que encontró la segunda dimensión cuando la
      // primera ya llenó el cupo, que es justo lo que el tope por dimensión evita.
      return Array.from(byId.values());
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
      const readCandidate = async (id: string) => {
        const snap = await getDoc(doc(cdb, 'candidates', id));
        return snap.exists() ? snap.data() : null;
      };
      let snap = await getDocs(query(collection(cdb, 'candidates'), where('phoneNormalized', '==', norm), limit(1)));
      if (!snap.empty) return followMergedInto(readCandidate, snap.docs[0].id);
      const variants = Array.from(new Set([norm, String(phone || ''), norm.startsWith('1') ? norm.slice(1) : norm].filter(Boolean)));
      for (const v of variants) {
        snap = await getDocs(query(collection(cdb, 'candidates'), where('phone', '==', v), limit(1)));
        if (!snap.empty) return followMergedInto(readCandidate, snap.docs[0].id);
      }
      // Ver el modo admin: un teléfono alternativo (de una unificación) es esa persona.
      for (const v of variants) {
        snap = await getDocs(query(collection(cdb, 'candidates'), where('alternatePhones', 'array-contains', v), limit(1)));
        if (!snap.empty) return followMergedInto(readCandidate, snap.docs[0].id);
      }
      return null;
    },
    async addWhatsappMessage(data) {
      await addDoc(collection(cdb, 'whatsapp_messages'), { ...data, sentAt: serverTimestamp() });
    },
    async listPendingCandidates(max) {
      const snap = await getDocs(query(collection(cdb, 'candidates'), where('aiStatus', '==', 'pending'), limit(max)));
      return snap.docs.map(d => {
        const c: any = d.data();
        return { id: d.id, cvUrl: c.cvUrl, cvFileType: c.cvFileType, fullName: c.fullName, email: c.email, phone: c.phone, city: c.city, source: c.source };
      });
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
    async retireOutboxIfQueued() { return false; },
    async retireQueuedOutboxBefore() { return 0; },
    async markOutbox() { /* no-op */ },
    async reclaimStuckOutbox() { return 0; },
    async countOutboxPending() { return 0; },
    async getOutboxMessage() { return null; },
    async listOutboxByPhone() { return []; },
    async listOutboxByStatuses() { return []; },
    async listQueuedOutboxManual() { return []; },
    async listOutboxRecentlySent() { return []; },
    async listOutboxRecentlyFailed() { return []; },
    async backfillOutboxFailedAt() { return 0; },
    async findOutboxIdByWaMessageId() { return null; },
    outboxVersion: () => 0,
    async listActiveVacancies() {
      const snap = await getDocs(query(collection(cdb, 'vacancies'), where('active', '==', true)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async listDocsByField(c, field, value, max) {
      const snap = await getDocs(query(collection(cdb, c), where(field, '==', value), limit(max)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async listDocs(c) {
      const snap = await getDocs(collection(cdb, c));
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
