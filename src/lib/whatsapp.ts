import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { sendEmail, getEmailTemplate } from './email';
import { apiFetch } from './api';

// Distinguishes an intentional skip (no message was meant to go out) from a real
// delivery failure, so callers can warn the recruiter only when something actually
// broke instead of on every stage change. 'queued' means the server persisted the
// message in its durable outbox and WILL deliver it (with retries) — for the recruiter
// that is success: nothing to do, nothing lost.
export type AutomationResult = {
  status: 'sent' | 'queued' | 'skipped' | 'failed';
  reason?: string;
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
export type WhatsAppStatus = { connected: boolean; outbox: boolean; pending: number; suspended: boolean };

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  try {
    const res = await apiFetch('/api/whatsapp/status');
    if (!res.ok) return { connected: false, outbox: false, pending: 0, suspended: false };
    const data = await res.json();
    return {
      connected: data.status === 'connected',
      outbox: !!data.outbox,
      pending: Number(data.pending) || 0,
      suspended: !!data.suspended,
    };
  } catch {
    return { connected: false, outbox: false, pending: 0, suspended: false };
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

export async function sendWhatsAppAutomation(
  phone: string,
  stage: string,
  variables: { nombre: string; vacante?: string; link?: string; fecha?: string; hora?: string; ubicacion?: string; email?: string }
): Promise<AutomationResult> {
  try {
    // Stages handled in person NEVER trigger an automatic message, even if a
    // custom template is configured in settings:
    //  - "Tests presenciales" / "Pruebas técnicas": the exam is given in person.
    //  - "Contratado": hiring is confirmed personally by the recruiter.
    const NO_AUTOMATION_STAGES = ['Tests presenciales', 'Pruebas técnicas', 'Contratado'];
    if (NO_AUTOMATION_STAGES.includes(stage)) return { status: 'skipped', reason: 'stage_sin_automatizacion' };

    // These messages advertise a date/time/place. Sending them without that data
    // (e.g. on a plain Kanban stage change) produced broken "Fecha: / Hora: ()"
    // invitations. Only send once a real fecha+hora is provided — which happens
    // when the recruiter schedules the interview from the Entrevistas page.
    const SCHEDULE_REQUIRED_STAGES = ['Convocado a entrevista', 'Entrevista presencial', 'Oferta'];
    if (SCHEDULE_REQUIRED_STAGES.includes(stage) && (!variables.fecha || !variables.hora)) {
      console.warn(`[whatsapp] Se omite "${stage}": falta fecha/hora. Agenda la cita en Entrevistas para enviar la invitación.`);
      return { status: 'skipped', reason: 'falta_fecha_hora' };
    }

    // Fetch templates
    const docRef = doc(db, 'settings', 'whatsapp_templates');
    const docSnap = await getDoc(docRef);

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

    let template = "";
    if (docSnap.exists() && docSnap.data().templates && docSnap.data().templates[stage]) {
      template = docSnap.data().templates[stage];
    } else {
      // Fallbacks if not configured. Written to read like a person from HR, not a
      // broadcast: the company introduces itself in the first line, 1-2 emojis at
      // most, and every message invites a reply — incoming replies are the best
      // legitimacy signal a WhatsApp number can earn.
      switch (stage) {
        case "Formulario etapa 2 enviado":
          template = "Hola {{nombre}}, te saluda el equipo de reclutamiento de {{empresa}} 👋\n\nRecibimos tu aplicación a la vacante de {{vacante}} y nos gustó tu perfil: queremos avanzar contigo a la siguiente etapa.\n\nEl próximo paso es completar este formulario antes del {{fecha}}:\n{{link}}\n\n¿Contamos contigo? Respóndenos por aquí para saber que recibiste este mensaje. Y si prefieres no continuar en el proceso, también puedes decírnoslo.";
          break;
        case "Convocado a entrevista":
          template = "Hola {{nombre}}, te escribimos de {{empresa}} por el proceso de {{vacante}}.\n\n¡Buenas noticias! Queremos invitarte a una entrevista virtual:\n\nFecha: {{fecha}}\nHora: {{hora}}\nModalidad: Virtual ({{ubicacion}})\n\n¿Te queda bien ese horario? Respóndenos por aquí para confirmar; si no puedes ese día, lo coordinamos. ¡Gracias!";
          break;
        case "Entrevista presencial":
          template = "Hola {{nombre}}, te escribimos de {{empresa}}. Pasaste a la etapa final del proceso para {{vacante}} 🎉\n\nQueremos conocerte en persona:\n\nFecha: {{fecha}}\nHora: {{hora}}\nLugar: {{ubicacion}}\n\n¿Nos confirmas tu asistencia respondiendo este mensaje? Si necesitas otro horario, dinos y lo buscamos.";
          break;
        case "Recordatorio de entrevista":
          template = "Hola {{nombre}}, te escribimos de {{empresa}} para recordarte tu entrevista para {{vacante}}:\n\nFecha: {{fecha}}\nHora: {{hora}}\nLugar: {{ubicacion}}\n\n¿Nos confirmas que podrás asistir? ¡Te esperamos!";
          break;
        case "Oferta":
          template = "Hola {{nombre}}, te escribimos de {{empresa}} con una excelente noticia: fuiste seleccionado(a) para el puesto de {{vacante}} 🎉\n\nQueremos reunirnos contigo para revisar los detalles y formalizar el inicio:\n\nFecha: {{fecha}}\nHora: {{hora}}\nLugar: {{ubicacion}}\n\n¿Nos confirmas por aquí? ¡Nos alegra mucho poder darte la bienvenida al equipo!";
          break;
        // "Contratado" intentionally has NO template: hiring is handled in person,
        // so no automatic WhatsApp is sent when a candidate is marked as hired.
        case "Descartado":
          template = "Hola {{nombre}}, te escribimos de {{empresa}}.\n\nGracias por participar en nuestro proceso para la vacante de {{vacante}}. En esta ocasión decidimos continuar con otros perfiles, pero valoramos de verdad el tiempo y el interés que dedicaste.\n\nTe deseamos muchos éxitos, y ojalá coincidamos en una próxima oportunidad.";
          break;
        case "Banco de talento":
          template = "Hola {{nombre}}, te escribimos de {{empresa}}.\n\nGracias por tu excelente participación en el proceso para {{vacante}}. Esta vez el proceso concluyó con otro perfil, pero tu desempeño nos gustó mucho.\n\nNos encantaría guardar tus datos en nuestro banco de talento para futuras oportunidades. ¿Nos autorizas? Responde \"Sí, autorizo\" y quedas dentro.";
          break;
      }
    }

    if (!template) return { status: 'skipped', reason: 'sin_plantilla' };

    // Replace variables
    let message = template.replace(/{{nombre}}/g, variables.nombre || '');
    message = message.replace(/{{vacante}}/g, variables.vacante || 'la vacante');
    message = message.replace(/{{empresa}}/g, companyName);
    message = message.replace(/{{link}}/g, variables.link || '');
    message = message.replace(/{{fecha}}/g, variables.fecha || '');
    message = message.replace(/{{hora}}/g, variables.hora || '');
    message = message.replace(/{{ubicacion}}/g, variables.ubicacion || '');

    // Send Email Automation if email is provided
    if (variables.email) {
      try {
        const emailHtml = getEmailTemplate(
          `Actualización de tu proceso: ${stage}`,
          message,
          companyLogoUrl
        );
        await sendEmail(variables.email, `Actualización de tu proceso - ${companyName}`, emailHtml);
      } catch (emailError) {
        console.error("Error sending email automation:", emailError);
      }
    }

    // Send message via API. stage/candidateName ride along so the durable outbox can
    // write the conversation history server-side when the message ACTUALLY goes out.
    const res = await apiFetch('/api/automations/stage-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, stage, candidateName: variables.nombre || '' })
    });

    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      console.error("Failed to parse API response. Status:", res.status);
      return { status: 'failed', reason: `respuesta_invalida_${res.status}` };
    }

    // The candidate asked not to receive WhatsApp messages; the server honors that
    // and skips silently. For the recruiter this is a deliberate skip, not a failure
    // (a failure would invite retries against someone who said stop).
    if (data.success && data.skipped === 'opt_out') {
      return { status: 'skipped', reason: 'candidato_pidio_no_contactar' };
    }

    // Durable outbox path: the server persisted the message and delivers it itself
    // (it also writes the history entry on actual delivery — no client write here,
    // that would duplicate the record).
    if (data.success && data.queued) {
      return { status: 'queued' };
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
      return { status: 'sent' };
    }
    // API reachable but the message did not go out (e.g. WhatsApp socket disconnected).
    return { status: 'failed', reason: data?.error || 'whatsapp_no_conectado' };
  } catch (error) {
    console.error("Error sending WhatsApp automation:", error);
    return { status: 'failed', reason: 'error_de_red' };
  }
}
