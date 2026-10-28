import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { sendEmail, getEmailTemplate } from './email';
import { apiFetch } from './api';
import { normalizePhone } from './phone';
import { notifyWhatsAppActivityChanged } from './whatsappActivity';
import { NO_AUTOMATION_STAGES, isStageMutedNow } from './stageNotifications';
import { renderMessage, messageSeed, seededRandom } from './messageVariation';
import { DEFAULT_WA_TEMPLATES, STAGE2_DEADLINE_DAYS } from './whatsappTemplates';
import type { PacingInfo } from './whatsappPacing';

// Distinguishes an intentional skip (no message was meant to go out) from a real
// delivery failure, so callers can warn the recruiter only when something actually
// broke instead of on every stage change. 'queued' means the server persisted the
// message in its durable outbox and WILL deliver it (with retries) — for the recruiter
// that is success: nothing to do, nothing lost.
export type AutomationResult = {
  status: 'sent' | 'queued' | 'skipped' | 'failed';
  reason?: string;
  /** The email notice went out — a later WhatsApp-only retry must not send it again. */
  emailed?: boolean;
};

// True when moving to this stage would attempt an automatic WhatsApp message from a
// plain stage change (no schedule data). Used by bulk moves to pre-flight the
// connection BEFORE moving anyone, so a batch is never half-notified.
// Only stages that actually have a message template belong here — returning true for
// template-less stages ('Nuevo', 'Aplicó', …) fired a pointless "messages won't be
// sent" warning when WhatsApp was offline even though nothing would ever be sent.
export function stageMayAutoSend(stage: string): boolean {
  const SEND_STAGES = [
    'Formulario etapa 2 enviado',
    'Descartado',
    'Banco de talento',
    'Contacto WhatsApp 1',
    'Recordatorio de entrevista',
  ];
  return SEND_STAGES.includes(stage);
}

// Stages whose WhatsApp message is an INVITATION that needs a real date/time/place.
// Moving a card here does NOT send anything (the invite goes out from the Entrevistas
// page once the appointment is scheduled) — callers use this to guide the recruiter
// there instead of leaving the move looking like nothing happened.
export function stageNeedsScheduling(stage: string): boolean {
  return ['Convocado a entrevista', 'Entrevista presencial', 'Oferta'].includes(stage);
}

// Live connection + queue snapshot from the server.
// `outbox` — the server has a durable queue: messages sent while disconnected are NOT
// lost, they wait and go out on reconnection. `pending` — how many are waiting now.
// `pacing` — the anti-ban budget and pace (daily limit, send window, messages/hour).
export type WhatsAppStatus = { connected: boolean; outbox: boolean; pending: number; suspended: boolean; pacing: PacingInfo | null };

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const offline: WhatsAppStatus = { connected: false, outbox: false, pending: 0, suspended: false, pacing: null };
  try {
    const res = await apiFetch('/api/whatsapp/status');
    if (!res.ok) return offline;
    const data = await res.json();
    return {
      connected: data.status === 'connected',
      outbox: !!data.outbox,
      pending: Number(data.pending) || 0,
      suspended: !!data.suspended,
      pacing: data.pacing && typeof data.pacing === 'object' ? data.pacing : null,
    };
  } catch {
    return offline;
  }
}

// Live connection check against the server socket status.
export async function isWhatsAppConnected(): Promise<boolean> {
  return (await getWhatsAppStatus()).connected;
}

// Spacing between consecutive DIRECT sends (dev fallback without the server outbox —
// in production the server queue paces everything with its own longer jitter). 600ms
// was a burst by WhatsApp anti-spam standards; 3s is the floor for identical texts.
export const SEND_SPACING_MS = 3000;
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * The template a stage sends: the one configured in Configuración, else the default
 * (with variations). Empty means the stage sends nothing. Throws if the settings can't
 * be read — sending a different text than the one the recruiter configured is worse
 * than reporting the failure.
 */
export async function getStageTemplate(stage: string): Promise<string> {
  const snap = await getDoc(doc(db, 'settings', 'whatsapp_templates'));
  const custom = snap.exists() ? snap.data()?.templates?.[stage] : undefined;
  if (typeof custom === 'string' && custom.trim()) return custom;
  return DEFAULT_WA_TEMPLATES[stage] || '';
}

// "jueves 15 de octubre": the stage-2 form's deadline when nobody set one. The template
// says "antes del {{fecha}}" and used to go out as "antes del :".
function defaultDeadline(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const timeZone = 'America/Santo_Domingo'; // the candidate's calendar, whatever this device's is
  return `${d.toLocaleDateString('es-DO', { weekday: 'long', timeZone })} ${d.toLocaleDateString('es-DO', { day: 'numeric', month: 'long', timeZone })}`;
}

export type AutomationChannels = {
  /** Default true. False = only the email goes out (no risk at all for the WhatsApp number). */
  whatsapp?: boolean;
  /** Default true (when the candidate has an email). */
  email?: boolean;
};

export async function sendWhatsAppAutomation(
  phone: string,
  stage: string,
  variables: { nombre: string; vacante?: string; link?: string; fecha?: string; hora?: string; ubicacion?: string; email?: string },
  options: { channels?: AutomationChannels } = {}
): Promise<AutomationResult> {
  let emailed = false;
  try {
    // Stages handled in person NEVER trigger an automatic message, even if a
    // custom template is configured in settings:
    //  - "Tests presenciales" / "Pruebas técnicas": the exam is given in person.
    //  - "Contratado": hiring is confirmed personally by the recruiter.
    if (NO_AUTOMATION_STAGES.includes(stage)) return { status: 'skipped', reason: 'stage_sin_automatizacion' };

    // The recruiter switched this stage's notification OFF (one click on its column or
    // template): moving here notifies nobody — no WhatsApp and no email.
    if (await isStageMutedNow(stage)) return { status: 'skipped', reason: 'etapa_sin_aviso' };

    // These messages advertise a date/time/place. Sending them without that data
    // (e.g. on a plain Kanban stage change) produced broken "Fecha: / Hora: ()"
    // invitations. Only send once a real fecha+hora is provided — which happens
    // when the recruiter schedules the interview from the Entrevistas page.
    const SCHEDULE_REQUIRED_STAGES = ['Convocado a entrevista', 'Entrevista presencial', 'Oferta'];
    if (SCHEDULE_REQUIRED_STAGES.includes(stage) && (!variables.fecha || !variables.hora)) {
      console.warn(`[whatsapp] Se omite "${stage}": falta fecha/hora. Agenda la cita en Entrevistas para enviar la invitación.`);
      return { status: 'skipped', reason: 'falta_fecha_hora' };
    }

    const sendWhatsApp = options.channels?.whatsapp !== false;
    const sendEmailToo = options.channels?.email !== false;

    const template = await getStageTemplate(stage);

    // Company identity: every template opens by saying WHO is writing. A message from
    // an unknown, unsaved number that never names the company is what recipients
    // report as spam — and recipient reports are the strongest account-ban signal.
    // Fetched once here; reused for the email branding below.
    let companyName = 'Darwin Cell';
    let companyLogoUrl = '';
    try {
      const companySnap = await getDoc(doc(db, 'settings', 'company'));
      if (companySnap.exists()) {
        if (companySnap.data().name) companyName = companySnap.data().name;
        if (companySnap.data().logoUrl) companyLogoUrl = companySnap.data().logoUrl;
      }
    } catch { /* branding is best-effort */ }

    if (!template) return { status: 'skipped', reason: 'sin_plantilla' };

    // One wording per recipient: {a|b} variations are resolved with a seed made from
    // THIS phone + notification, so a bulk move never sends the same text to everyone,
    // while a retry renders the identical text (the server dedupes on it). Seed and
    // dedupe key use the caller's values — never the default deadline added below,
    // which changes from one day to the next.
    const seed = messageSeed(normalizePhone(phone || ''), stage, variables);
    // dedupeKey = this exact notification; topicKey = its kind (stage + vacancy): a newer
    // one of the same kind (a rescheduled interview) replaces one still waiting in the queue.
    const topicKey = JSON.stringify([stage, variables.vacante || '']).slice(0, 300);
    const dedupeKey = JSON.stringify([stage, variables.vacante || '', variables.fecha || '', variables.hora || '']).slice(0, 300);
    const vars = { ...variables, empresa: companyName };
    if (stage === 'Formulario etapa 2 enviado' && !vars.fecha) vars.fecha = defaultDeadline(STAGE2_DEADLINE_DAYS);
    const message = renderMessage(template, vars, seededRandom(seed));

    // Send Email Automation if email is provided
    if (variables.email && sendEmailToo) {
      try {
        const emailHtml = getEmailTemplate(
          `Actualización de tu proceso: ${stage}`,
          message,
          companyLogoUrl
        );
        const r = await sendEmail(variables.email, `Actualización de tu proceso - ${companyName}`, emailHtml);
        emailed = !!r?.success;
      } catch (emailError) {
        console.error("Error sending email automation:", emailError);
      }
    }

    // Email-only move (chosen in the bulk confirmation): the WhatsApp number stays out of it.
    if (!sendWhatsApp) return { status: 'skipped', reason: emailed ? 'solo_correo' : 'sin_envio', emailed };

    // Send message via API. stage/candidateName ride along so the durable outbox can
    // write the conversation history server-side when the message ACTUALLY goes out.
    const res = await apiFetch('/api/automations/stage-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, stage, candidateName: variables.nombre || '', dedupeKey, topicKey })
    });

    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      console.error("Failed to parse API response. Status:", res.status);
      return { status: 'failed', reason: `respuesta_invalida_${res.status}`, emailed };
    }

    // The candidate asked not to receive WhatsApp messages; the server honors that
    // and skips silently. For the recruiter this is a deliberate skip, not a failure
    // (a failure would invite retries against someone who said stop).
    if (data.success && data.skipped === 'opt_out') {
      return { status: 'skipped', reason: 'candidato_pidio_no_contactar', emailed };
    }
    // The server enforces the stage switch too (a screen opened before it was flipped).
    if (data.success && data.skipped === 'etapa_sin_aviso') {
      return { status: 'skipped', reason: 'etapa_sin_aviso', emailed };
    }

    // Durable outbox path: the server persisted the message and delivers it itself
    // (it also writes the history entry on actual delivery — no client write here,
    // that would duplicate the record).
    if (data.success && data.queued) {
      notifyWhatsAppActivityChanged(); // the side panel shows it right away
      return { status: 'queued', emailed };
    }

    if (data.success && data.messageSent) {
      // Find candidate ID by phone to save the message
      const candidatesRef = collection(db, 'candidates');
      const q = query(candidatesRef, where('phone', '==', phone));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const candidateId = querySnapshot.docs[0].id;
        await addDoc(collection(db, 'whatsapp_messages'), {
          candidateId,
          text: message,
          sentAt: serverTimestamp(),
          direction: 'outbound',
          isAutomated: true,
          stage
        });
      }
      return { status: 'sent', emailed };
    }
    // API reachable but the message did not go out (e.g. WhatsApp socket disconnected).
    return { status: 'failed', reason: data?.error || 'whatsapp_no_conectado', emailed };
  } catch (error) {
    console.error("Error sending WhatsApp automation:", error);
    return { status: 'failed', reason: 'error_de_red', emailed };
  }
}

/**
 * A sent message the candidate can't read ("Esperando el mensaje. Esto puede tomar
 * tiempo"). 'repair' renews the encryption session with the candidate's phone and
 * re-sends the SAME message — the stuck bubble turns into the real text, and a phone
 * that already had it ignores the copy. 'resend' queues a NEW copy that starts from a
 * fresh session (for messages too old to repair). Resolves to an error text, or null.
 */
export async function repairWhatsAppMessage(outboxId: string, mode: 'repair' | 'resend'): Promise<string | null> {
  try {
    const res = await apiFetch('/api/whatsapp/outbox/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: outboxId, mode }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as any));
      return d?.error || 'No se pudo completar la acción.';
    }
    notifyWhatsAppActivityChanged();
    return null;
  } catch {
    return 'No se pudo completar la acción (sin conexión).';
  }
}
