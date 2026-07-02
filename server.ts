import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import dotenv from "dotenv";
import { 
  default as makeWASocketImport,
  makeWASocket,
  DisconnectReason, 
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  type WASocket
} from "@whiskeysockets/baileys";
import WAProtoModule from "@whiskeysockets/baileys/WAProto/index.js";
const { proto } = WAProtoModule;
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import pino from "pino";
import fs from "fs";
import mammoth from "mammoth";

import { setLogLevel } from 'firebase/firestore';
import { getServerDb, type ServerDb } from './serverDb';

import nodemailer from "nodemailer";

// Disable annoying firestore GRPC listen stream logs
setLogLevel('silent');

// Prevent unhandled promise rejections from killing the server
// specially useful for bailey's websocket timeout errors
process.on('unhandledRejection', (reason: any, promise) => {
  // Silence expected non-fatal Baileys timeouts to avoid noise
  if (reason?.message === 'Timed Out' || reason?.output?.payload?.message === 'Timed Out') {
    return;
  }
  console.error('[Unhandled Rejection]', reason);
});

// Server-side Firestore access (Admin SDK preferred, client SDK fallback).
// Assigned in bootstrap() before the server and WhatsApp client start.
let db: ServerDb;

dotenv.config({ override: true });

function getAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.replace(/['"]/g, '').trim() : undefined;
  
  if (apiKey === "MY_GEMINI_API_KEY") {
    return null; // Signals that we have a bad configured key
  }

  return new GoogleGenAI({ apiKey });
}
const logger = pino({ level: 'silent' });

// WhatsApp State
let sock: WASocket | null = null;
let qrCode: string | null = null;
let connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'qr' = 'disconnected';

// Custom Firestore auth state to ensure persistence across container restarts
const useFirestoreAuthState = async (collectionName: string) => {
  const writeData = async (data: any, id: string) => {
    try {
      const str = JSON.stringify(data, BufferJSON.replacer);
      await db.setDocData(collectionName, id, { data: str });
    } catch (error) {
      console.error("Error saving WhatsApp auth state to Firestore:", error);
    }
  };

  const readData = async (id: string) => {
    try {
      const docData = await db.getDocData(collectionName, id);
      if (docData && docData.data) {
        return JSON.parse(docData.data, BufferJSON.reviver);
      }
    } catch (error) {
      console.error("Error reading WhatsApp auth state from Firestore:", error);
    }
    return null;
  };

  const removeData = async (id: string) => {
    try {
      await db.deleteDocData(collectionName, id);
    } catch (error) {
      console.error("Error deleting WhatsApp auth state from Firestore:", error);
    }
  };

  const creds = await readData('creds') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: any = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => {
      return writeData(creds, 'creds');
    }
  };
};

async function connectToWhatsApp() {
  const collectionName = process.env.NODE_ENV === 'production' ? 'whatsapp_auth_prod' : 'whatsapp_auth_dev';
  const { state, saveCreds } = await useFirestoreAuthState(collectionName);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger as any),
    },
    logger: logger as any,
    browser: ["ATS RRHH", "Chrome", "1.0.0"]
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      qrCode = await QRCode.toDataURL(qr);
      connectionStatus = 'qr';
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      
      connectionStatus = 'disconnected';
      qrCode = null;
      console.log('WhatsApp connection closed. Status Code:', statusCode, 'Reason:', (lastDisconnect?.error as Boom)?.message);
      
      // If we got a 440 conflict, we don't auto-reconnect immediately to prevent massive infinite loops where dev and prod keep kicking each other.
      // The user must click "Force Reconnect" in the UI to claim the session.
      if (statusCode === DisconnectReason.connectionReplaced) {
        console.log('WhatsApp connection replaced (Status 440). Suspending auto-reconnect. Please click "Forzar Reconexión" in the settings.');
      } else if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Attempting to reconnect in 5 seconds...');
        setTimeout(() => {
          connectToWhatsApp().catch(err => console.error('Failed to reconnect:', err));
        }, 5000);
      } else {
        console.log('WhatsApp logged out. Need to scan new QR.');
      }
    } else if (connection === 'open') {
      connectionStatus = 'connected';
      qrCode = null;
      console.log('WhatsApp connection opened');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        if (!msg.key.fromMe && msg.message) {
          const from = msg.key.remoteJid;
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
          
          if (from && text) {
            try {
              // Extract phone number from JID (e.g., "18091234567@s.whatsapp.net" -> "18091234567")
              const phone = from.split('@')[0];

              // Find candidate by phone, then persist the inbound message.
              const candidateId = await db.findCandidateIdByPhone(phone);
              if (candidateId) {
                await db.addWhatsappMessage({
                  candidateId,
                  direction: 'inbound',
                  text: text,
                  status: 'received',
                });
                console.log(`Saved incoming message from ${phone} for candidate ${candidateId}`);
              }
            } catch (error) {
              console.error("Error saving incoming WhatsApp message:", error);
            }
          }
        }
      }
    }
  });
}

// Initialize the data layer first, then the WhatsApp client and HTTP server.
async function bootstrap() {
  db = await getServerDb();
  connectToWhatsApp().catch(err => console.error('Failed to initialize WhatsApp:', err));
  startServer();

  // In admin mode the backend owns CV processing (centralized, no per-browser duplication).
  if (db.canEnforceAuth) {
    console.log('[server CV worker] Admin mode — backend CV processor enabled (browser worker stands down).');
    processPendingCVs();
    setInterval(() => { processPendingCVs().catch(e => console.error('[server CV worker]', e)); }, 60_000);
  }
}

// ---------------------------------------------------------------------------
// CV parsing used by the backend CV worker. Mirrors the /api/parse-cv endpoint
// logic; kept as a function so the worker can score CVs without an HTTP round-trip.
// ---------------------------------------------------------------------------
class CvParseError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function runCvParse(input: { pdfBase64?: string; mimeType?: string; fileUrl?: string }): Promise<any> {
  const { pdfBase64, fileUrl } = input;
  const mimeType = input.mimeType || 'application/pdf';
  let base64Data = pdfBase64;

  if (fileUrl) {
    let fileRes: Response;
    try {
      fileRes = await fetch(fileUrl);
    } catch (fetchErr) {
      console.error("Error fetching file from URL:", fetchErr);
      throw new CvParseError(400, "Failed to fetch file from URL");
    }
    if (!fileRes.ok) {
      console.error(`[parse-cv] Error fetching file from URL. Status: ${fileRes.status}`);
      throw new CvParseError(400, `No se pudo descargar el archivo del candidato. Código de error de Storage: ${fileRes.status}`);
    }
    const arrayBuffer = await fileRes.arrayBuffer();
    base64Data = Buffer.from(arrayBuffer).toString('base64');
  }

  if (!base64Data) {
    throw new CvParseError(400, "No PDF provided");
  }

  const cvSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      full_name: { type: Type.STRING, nullable: true },
      phone: { type: Type.STRING, nullable: true },
      email: { type: Type.STRING, nullable: true },
      city: { type: Type.STRING, nullable: true },
      experience_total_years: { type: Type.NUMBER, nullable: true },
      relevant_experience_summary: { type: Type.STRING },
      education_summary: { type: Type.STRING },
      strengths_detected: { type: Type.ARRAY, items: { type: Type.STRING } },
      risk_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
      initial_score_1_to_5: { type: Type.NUMBER },
      recommendation: { type: Type.STRING, enum: ["advance", "review", "low_priority"] },
      justification: { type: Type.STRING }
    },
    required: ["relevant_experience_summary", "education_summary", "strengths_detected", "risk_flags", "initial_score_1_to_5", "recommendation", "justification"]
  };

  const prompt = `
  Eres un analista de reclutamiento asistido por IA dentro de un ATS.
  Tu rol es extraer, resumir y puntuar información de candidatos de forma estructurada a partir de su CV.
  El archivo adjunto puede ser un documento PDF, de Word o directamente una imagen/foto del currículum. Debes extraer el texto y analizarlo sin importar su formato de origen.
  No decides contrataciones finales.
  No afirmas diagnósticos psicológicos ni criminales.

  MUY IMPORTANTE:
  No extraigas ni asumas habilidades (skills) basadas únicamente en lo que el candidato escribe en su CV, ya que esto se evaluará posteriormente en la práctica mediante tests y entrevistas. Tu análisis debe centrarse en la experiencia demostrable, la educación, y las fortalezas o riesgos que se puedan deducir de su trayectoria.

  PUNTUACIÓN (ESTRELLAS):
  Califica el CV con una puntuación de estrellas desde 0.1 hasta 5.0 (ej. 3.5, 4.2, 4.8) en el campo 'initial_score_1_to_5'.
  Esta es una calificación preliminar basada únicamente en la estructura, experiencia demostrable y presentación del CV.

  Siempre devuelves JSON válido según el esquema entregado.
  Si faltan datos, lo indicas explícitamente en lugar de inventar.

  IMPORTANTE PARA EL TELÉFONO: Extrae el número de teléfono e incluye siempre el código de país. Si no lo tiene, asume +52. El formato ideal es solo números con el código de país (ej. +525551234567).

  Analiza el siguiente CV (que puede ser documento o imagen) y extrae la información solicitada.
  `;

  let contentsPart: any;
  if (mimeType.includes('wordprocessingml.document') || mimeType.includes('msword')) {
    contentsPart = { text: "Texto extraído del CV:\n" + (await mammoth.extractRawText({ buffer: Buffer.from(base64Data, 'base64') })).value };
  } else {
    contentsPart = { inlineData: { data: base64Data, mimeType } };
  }

  console.log(`[parse-cv] Sending request to Gemini... MimeType: ${mimeType}, Size: ${base64Data.length}`);

  const ai = getAI();
  if (!ai) {
    throw new CvParseError(400, "CLAVE INVÁLIDA: Tienes configurada la clave 'MY_GEMINI_API_KEY' en la pestaña 'Secrets'. Para solucionar esto: 1) Haz clic en 'Settings' (arriba a la derecha), 2) Entra a 'Secrets', 3) Busca 'GEMINI_API_KEY' y elimínalo haciendo clic en el icono de bote de basura. Si haces esto usarás la IA gratuita automáticamente.");
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: [prompt, contentsPart],
    config: {
      responseMimeType: "application/json",
      responseSchema: cvSchema,
      temperature: 0.2
    }
  });

  const resultText = response.text;
  if (!resultText) throw new Error("Empty response from Gemini");
  const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(cleanJson);
}

// Backend CV worker: in admin mode the server (not each recruiter's browser) processes
// pending CVs. Candidates are claimed atomically so concurrent runs never double-process.
let cvWorkerRunning = false;
async function processPendingCVs() {
  if (cvWorkerRunning || !db?.canEnforceAuth) return;
  cvWorkerRunning = true;
  try {
    const pending = await db.listPendingCandidates(10);
    for (const cand of pending) {
      const claimed = await db.claimCandidate(cand.id);
      if (!claimed) continue;

      const isBulk = typeof cand.fullName === 'string' && cand.fullName.startsWith('Procesando:');
      try {
        const parsedData = await runCvParse({ fileUrl: cand.cvUrl, mimeType: cand.cvFileType || 'application/pdf' });

        const candidateUpdate: any = { aiExtraction: parsedData, aiStatus: 'completed' };
        if (isBulk) {
          if (parsedData.full_name) candidateUpdate.fullName = parsedData.full_name;
          if (parsedData.email) candidateUpdate.email = parsedData.email;
          if (parsedData.phone) candidateUpdate.phone = parsedData.phone;
          if (parsedData.city) candidateUpdate.city = parsedData.city;
        }
        await db.setDocData('candidates', cand.id, candidateUpdate);

        const appIds = await db.getApplicationIdsByCandidate(cand.id);
        for (const appId of appIds) {
          const appUpdate: any = { scoreSummary: parsedData.initial_score_1_to_5, recommendation: parsedData.recommendation };
          if (isBulk && parsedData.full_name) appUpdate.candidateName = parsedData.full_name;
          await db.setDocData('applications', appId, appUpdate);
        }
        console.log(`[server CV worker] Scored candidate ${cand.id}: ${parsedData.initial_score_1_to_5} stars`);
      } catch (err: any) {
        console.error(`[server CV worker] Error processing ${cand.id}:`, err?.message || err);
        await db.setDocData('candidates', cand.id, { aiStatus: 'error', aiError: err?.message || String(err) });
        if (isBulk) {
          const appIds = await db.getApplicationIdsByCandidate(cand.id);
          for (const appId of appIds) {
            await db.setDocData('applications', appId, { candidateName: `⚠️ Error de lectura: ${cand.fullName!.replace('Procesando: ', '')}` });
          }
        }
      }
    }
  } catch (err) {
    console.error('[server CV worker] loop error:', err);
  } finally {
    cvWorkerRunning = false;
  }
}

async function startServer() {
  const app = express();
  // Cloud Run injects PORT (defaults to 8080); fall back to 3000 for local dev.
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Trust exactly ONE proxy hop (Cloud Run's front end). Using `true` would trust the
  // entire X-Forwarded-For chain, letting a client spoof req.ip and bypass per-IP limits.
  // Per-IP limiting is therefore best-effort; the global cap below is the real budget guard.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '20mb' }));

  // Custom error handler for JSON parsing issues
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: "Payload too large" });
    }
    next(err);
  });

  // ---------------------------------------------------------------------------
  // Security middleware
  // ---------------------------------------------------------------------------
  // Requires a valid recruiter/admin Firebase ID token. Enforcement is active only
  // when the Admin SDK is available (db.canEnforceAuth); in client fallback mode it
  // fails open so the app keeps working until admin credentials are configured.
  let warnedNoEnforce = false;
  const requireRecruiter = async (req: any, res: any, next: any) => {
    if (!db?.canEnforceAuth) {
      if (!warnedNoEnforce) {
        console.warn('[auth] API auth NOT enforced (no admin credentials). Configure GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON to enable.');
        warnedNoEnforce = true;
      }
      return next();
    }
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'No autenticado' });
      const identity = await db.verifyRecruiter(token);
      if (!identity || !identity.isRecruiter) {
        return res.status(403).json({ error: 'Acceso restringido a reclutadores' });
      }
      req.user = identity;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  };

  // Lightweight in-memory fixed-window rate limiter (per client IP, per minute).
  // Best-effort only: req.ip can be partially spoofed via X-Forwarded-For, so this adds
  // fairness between callers but is NOT the budget guard — see globalRateLimit below.
  // Single-instance only — a shared store (Redis) is needed when scaling horizontally.
  const rateLimit = (maxPerMinute: number) => {
    const hits = new Map<string, { count: number; resetAt: number }>();
    return (req: any, res: any, next: any) => {
      const now = Date.now();
      if (hits.size > 10000) hits.clear(); // crude unbounded-growth guard
      const key = req.ip || 'unknown';
      let entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + 60_000 };
        hits.set(key, entry);
      }
      entry.count++;
      if (entry.count > maxPerMinute) {
        return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' });
      }
      return next();
    };
  };

  // Global (all-callers) fixed-window cap. This is the real protection for the AI/email
  // budget: it bounds total calls per minute regardless of source IP, so it CANNOT be
  // bypassed by spoofing/rotating X-Forwarded-For. Set generously above legitimate volume.
  const globalRateLimit = (maxPerMinute: number) => {
    let count = 0;
    let resetAt = 0;
    return (req: any, res: any, next: any) => {
      const now = Date.now();
      if (now > resetAt) {
        count = 0;
        resetAt = now + 60_000;
      }
      count++;
      if (count > maxPerMinute) {
        return res.status(429).json({ error: 'Servicio con alta demanda en este momento. Intenta de nuevo en un minuto.' });
      }
      return next();
    };
  };

  // API routes
  app.get("/api/health", (req, res) => {
    // Do not leak secret metadata (presence/length of API keys) to unauthenticated callers.
    // serverCvWorker tells the browser CV worker to stand down when the backend handles it.
    res.json({ status: "ok", serverCvWorker: !!db?.canEnforceAuth });
  });

  // Email Endpoint (public: also used by the candidate application flow). Rate limited.
  // Shared mail sender. Returns {success, simulated?}. Never lets the caller
  // control anything beyond a single recipient/subject/html that WE assemble.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sendMail = async (to: string, subject: string, html: string) => {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("Email not sent: SMTP credentials missing. Would have sent to:", to);
      return { success: true, simulated: true };
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"Darwin Cell RRHH" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    return { success: true };
  };

  // Recruiter-only: arbitrary transactional email (used by stage automations).
  // Previously PUBLIC — an open relay that let anyone send arbitrary HTML from the
  // company address to any recipient. Now gated behind recruiter auth.
  app.post("/api/email/send", requireRecruiter, globalRateLimit(120), rateLimit(60), async (req, res) => {
    try {
      const { to, subject, html } = req.body || {};
      if (typeof to !== 'string' || !EMAIL_RE.test(to)) return res.status(400).json({ error: 'Destinatario inválido' });
      if (typeof subject !== 'string' || typeof html !== 'string') return res.status(400).json({ error: 'Asunto/contenido inválido' });
      if (subject.length > 300 || html.length > 100_000) return res.status(413).json({ error: 'Contenido demasiado largo' });
      const r = await sendMail(to, subject.slice(0, 300), html);
      res.json(r);
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Public (rate-limited): the ONE fixed message a candidate may trigger — the
  // "we received your application" confirmation. The template is built here from a
  // trusted layout; the client cannot supply HTML/subject/attachments, so this
  // cannot be used as a spam/phishing relay.
  app.post("/api/public/apply-confirmation", globalRateLimit(60), rateLimit(10), async (req, res) => {
    try {
      const { email, name, vacancyTitle } = req.body || {};
      if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 200) {
        return res.status(400).json({ error: 'Correo inválido' });
      }
      const safe = (s: any, max: number) => (typeof s === 'string' ? s : '').replace(/[<>]/g, '').slice(0, max);
      const cleanName = safe(name, 120) || 'candidato';
      const cleanVacancy = safe(vacancyTitle, 160) || 'nuestra empresa';

      let companyName = 'Darwin Cell';
      let logoUrl = '';
      try {
        const company = await db.getDocData('settings', 'company');
        if (company?.name) companyName = String(company.name).slice(0, 120);
        if (company?.logoUrl) logoUrl = String(company.logoUrl);
      } catch { /* branding is best-effort */ }

      const body = `Hola ${cleanName},<br/><br/>Gracias por postularte a la vacante de <strong>${cleanVacancy}</strong>.<br/><br/>Hemos recibido tu currículum correctamente y nuestro equipo de reclutamiento lo estará evaluando en los próximos días.<br/><br/>Si tu perfil se ajusta a lo que buscamos, te contactaremos para el siguiente paso.<br/><br/>¡Mucho éxito!<br/><br/>Atentamente,<br/>El equipo de ${companyName}`;
      const html = `<div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#fff;padding:24px;text-align:center;border-bottom:2px solid #f1f5f9;">${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:80px;object-fit:contain;"/>` : `<h1 style="color:#0f172a;margin:0;font-size:24px;">${companyName}</h1>`}</div>
        <div style="padding:32px;background:#fff;color:#334155;line-height:1.6;font-size:16px;"><h2 style="color:#0f172a;margin-top:0;font-size:20px;">¡Hemos recibido tu currículum!</h2><div style="margin-top:20px;">${body}</div></div>
        <div style="background:#f8fafc;padding:20px;text-align:center;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">© ${new Date().getFullYear()} ${companyName}. Correo automático, por favor no respondas.</div>
      </div>`;
      const r = await sendMail(email, `Confirmación de postulación - ${companyName}`, html);
      res.json(r);
    } catch (error) {
      console.error("Error sending confirmation email:", error);
      res.status(500).json({ error: "Failed to send confirmation" });
    }
  });

  // WhatsApp Endpoints
  const formatWhatsAppNumber = (phone: string) => {
    let cleaned = phone.replace(/\D/g, '');
    
    // En República Dominicana (y otros países del NANP), el código de país es +1
    // Los números locales tienen 10 dígitos (ej. 809XXXXXXX, 829XXXXXXX, 849XXXXXXX)
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    
    return cleaned + '@s.whatsapp.net';
  };

  app.get("/api/whatsapp/status", requireRecruiter, (req, res) => {
    res.json({ status: connectionStatus, qr: qrCode, session: "v2" });
  });

  app.post("/api/whatsapp/reconnect", requireRecruiter, async (req, res) => {
    try {
      console.log("Manual WhatsApp reconnect requested...");
      // Optional: clean up the old socket if it still exists somehow
      if (sock) {
        try { sock.logout("Manual reconnect"); } catch(e) {}
        sock = null;
      }
      connectionStatus = 'disconnected';
      qrCode = null;
      await connectToWhatsApp();
      res.json({ success: true, status: 'reconnecting' });
    } catch (error) {
      console.error("Manual reconnect failed:", error);
      res.status(500).json({ error: "Failed to reconnect" });
    }
  });

  app.post("/api/whatsapp/logout", requireRecruiter, async (req, res) => {
    try {
      console.log("Manual WhatsApp logout requested...");
      if (sock) {
        try { sock.logout("Manual logout"); } catch(e) {}
        sock = null;
      }
      
      const collectionName = process.env.NODE_ENV === 'production' ? 'whatsapp_auth_prod' : 'whatsapp_auth_dev';
      await db.deleteCollection(collectionName);

      qrCode = null;
      connectionStatus = 'disconnected';
      await connectToWhatsApp();
      
      res.json({ success: true, message: "Logged out specifically" });
    } catch (error) {
      console.error("Manual logout failed:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  });

  app.post("/api/whatsapp/send", requireRecruiter, async (req, res) => {
    try {
      const { phone, message } = req.body;
      if (!sock || connectionStatus !== 'connected' || !sock?.user?.id) {
        return res.status(400).json({ error: "WhatsApp not fully connected" });
      }

      const formattedPhone = formatWhatsAppNumber(phone);
      
      await sock.sendMessage(formattedPhone, { text: message });
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending WhatsApp:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.post("/api/automations/stage-change", requireRecruiter, async (req, res) => {
    try {
      const { phone, message } = req.body;
      if (!sock || connectionStatus !== 'connected' || !sock?.user?.id) {
        return res.status(400).json({ error: "WhatsApp not connected" });
      }
      if (!phone) return res.status(400).json({ error: "Phone number required" });
      if (!message) return res.json({ success: true, messageSent: false, reason: "No message provided" });

      const jid = formatWhatsAppNumber(phone);
      await sock.sendMessage(jid, { text: message });
      return res.json({ success: true, messageSent: true });
    } catch (error) {
      console.error("Automation error:", error);
      res.status(500).json({ error: "Automation failed" });
    }
  });

  // Upload the public "careers" hero image (team photo) via the Admin SDK, which
  // bypasses Storage security rules — so recruiters can set it without the bucket
  // needing a public-write rule. Returns a stable public download URL.
  app.post("/api/company/careers-image", requireRecruiter, async (req, res) => {
    try {
      const { dataUrl } = req.body || {};
      if (typeof dataUrl !== 'string') {
        return res.status(400).json({ error: 'Falta la imagen (dataUrl).' });
      }
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Formato de imagen inválido. Debe ser una imagen.' });
      }
      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ error: 'La imagen supera 5MB.' });
      }
      const ext = contentType.split('/')[1].split('+')[0].replace('jpeg', 'jpg');
      const url = await db.uploadPublicFile(`company/careers-hero-${Date.now()}.${ext}`, buffer, contentType);
      return res.json({ url });
    } catch (error) {
      console.error("Careers image upload error:", error);
      res.status(500).json({ error: "No se pudo subir la imagen." });
    }
  });

  app.post("/api/score-stage2", globalRateLimit(60), rateLimit(20), async (req, res) => {
    try {
      const { answers } = req.body;
      
      const stage2Schema: Schema = {
        type: Type.OBJECT,
        properties: {
          stability_motivation_score: { type: Type.NUMBER, description: "Puntuación de 0 a 20" },
          problem_solving_score: { type: Type.NUMBER, description: "Puntuación de 0 a 20" },
          integrity_ethics_score: { type: Type.NUMBER, description: "Puntuación de 0 a 25" },
          behavioral_attitude_score: { type: Type.NUMBER, description: "Puntuación de 0 a 25" },
          orthography_score: { type: Type.NUMBER, description: "Puntuación de 0 a 10 basada en la ortografía y redacción del candidato" },
          total_score: { type: Type.NUMBER, description: "Suma total sobre 100" },
          positive_signals: { type: Type.ARRAY, items: { type: Type.STRING } },
          risk_signals: { type: Type.ARRAY, items: { type: Type.STRING } },
          spelling_mistakes: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Lista de palabras mal escritas o errores de puntuación (ej. 'llebo' en vez de 'llevo', falta de comas). NO incluyas faltas de tilde." },
          incorrect_answers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Lista de respuestas que fueron consideradas incorrectas, evasivas o negativas, con una breve explicación de por qué." },
          consistency_notes: { type: Type.STRING },
          recommended_next_step: { type: Type.STRING, enum: ["contratar", "muy_recomendable", "considerar_con_reservas", "no_recomendable"] },
          summary_for_recruiter: { type: Type.STRING }
        },
        required: ["stability_motivation_score", "problem_solving_score", "integrity_ethics_score", "behavioral_attitude_score", "orthography_score", "total_score", "positive_signals", "risk_signals", "spelling_mistakes", "incorrect_answers", "consistency_notes", "recommended_next_step", "summary_for_recruiter"]
      };

      const prompt = `
      Eres un experto en evaluación de talento. Analiza las siguientes respuestas de un candidato en la Etapa 2 de un proceso de selección.
      
      PERFIL OBJETIVO:
      - NO usar como criterio: "sumiso", "dócil" o "fácil de manejar".
      - SÍ usar como criterio: cooperativo, entrenable, receptivo al feedback, respetuoso de procesos, estable emocionalmente, orientado al servicio, responsable, íntegro y con deseo real de mejorar.
      
      FÓRMULA DE PUNTUACIÓN (Total 100 puntos):
      - Estabilidad y Motivación (20 puntos): Visión a futuro, razones para cambiar de trabajo, metas claras.
      - Resolución de Problemas y Logros (20 puntos): Capacidad para superar retos, inteligencia práctica, aprendizaje de experiencias pasadas.
      - Integridad y Ética (25 puntos): Reacción ante actos antiéticos, honestidad, valores alineados a la empresa.
      - Ajuste Conductual y Actitud (25 puntos): Madurez emocional, autocrítica (qué cambiaría de su trabajo anterior), nivel de responsabilidad.
      - Ortografía y Redacción (10 puntos): 
        * REGLA CRÍTICA: IGNORA por completo la falta de tildes/acentos. No restes puntos por no poner tildes (ej. "papa" en vez de "papá" está BIEN).
        * REGLA CRÍTICA: IGNORA si el candidato inicia oraciones o párrafos con minúscula. No restes puntos por falta de mayúsculas iniciales.
        * SÍ penaliza la falta de comas o signos de puntuación necesarios.
        * SÍ penaliza el uso de letras incorrectas (ej. "llebo" en vez de "llevo", "hay" en vez de "ay").
        * Ejemplo de lo que está BIEN (10/10): "ay, pero mi papa me llevo a la escuela." (Faltan tildes y mayúsculas, pero letras y comas están bien).
        * Ejemplo de lo que está MAL: "hay, pero mi papa me llebo a la escuela." (Mal uso de 'hay' y 'llebo').
        * Ejemplo de lo que está MAL: "ay pero mi papa me llevo a la escuela." (Falta la coma después de 'ay').
      
      INTERPRETACIÓN:
      - 90-100: contratar
      - 80-89: muy_recomendable
      - 70-79: considerar_con_reservas
      - menos de 70: no_recomendable
      
      REGLAS DE DESCARTE AUTOMÁTICO (si detectas esto, baja drásticamente el puntaje):
      - Tolerancia o complicidad ante actos antiéticos (ej. robar o hacer trampa).
      - Culpar excesivamente a otros o a la empresa anterior sin autocrítica.
      - Respuestas extremadamente cortas, vacías o evasivas en preguntas clave.
      
      Respuestas del candidato:
      ${Object.entries(answers).map(([q, a]) => `- ${q}: ${a}`).join('\n')}
      
      Devuelve un análisis estructurado en JSON.
      `;

      const ai = getAI();
      if (!ai) {
        return res.status(400).json({ error: "CLAVE INVÁLIDA: Tienes configurada la clave 'MY_GEMINI_API_KEY' en la pestaña 'Secrets'. Para solucionar esto: 1) Haz clic en 'Settings' (arriba a la derecha), 2) Entra a 'Secrets', 3) Busca 'GEMINI_API_KEY' y elimínalo haciendo clic en el icono de bote de basura. Si haces esto usarás la IA gratuita automáticamente." });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [prompt],
        config: {
          responseMimeType: "application/json",
          responseSchema: stage2Schema,
          temperature: 0.2
        }
      });

      const resultText = response.text;
      if (!resultText) throw new Error("Empty response from Gemini");
      
      const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
      const parsedData = JSON.parse(cleanJson);
      
      // Note: In a real app, we would update Firestore here too, 
      // but for this demo, we'll just return it and let the frontend handle it or vice versa.
      // Actually, let's just return it.
      res.json(parsedData);

    } catch (error: any) {
      console.error("Error scoring stage 2:", error);
      res.status(500).json({ error: "Failed to score stage 2", details: error.message || String(error) });
    }
  });

  app.get("/api/test-ai", requireRecruiter, async (req, res) => {
    try {
      const ai = getAI();
      if (!ai) {
        return res.status(400).json({ success: false, error: "CLAVE INVÁLIDA: Tienes configurada la clave 'MY_GEMINI_API_KEY' en la pestaña 'Secrets'. Para solucionar esto: 1) Haz clic en 'Settings' (arriba a la derecha), 2) Entra a 'Secrets', 3) Busca 'GEMINI_API_KEY' y elimínalo haciendo clic en el icono de bote de basura. Si haces esto usarás la IA gratuita automáticamente." });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: ["Say 'Hello, AI is working!'"]
      });
      res.json({ success: true, message: response.text });
    } catch (error: any) {
      console.error("Test AI Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/parse-cv", requireRecruiter, async (req, res) => {
    try {
      const { pdfBase64, mimeType, fileUrl } = req.body;
      
      let base64Data = pdfBase64;
      
      if (fileUrl) {
        try {
          const fileRes = await fetch(fileUrl);
          if (!fileRes.ok) {
            console.error(`[parse-cv] Error fetching file from URL. Status: ${fileRes.status}`);
            return res.status(400).json({ error: `No se pudo descargar el archivo del candidato. Código de error de Storage: ${fileRes.status}` });
          }
          const arrayBuffer = await fileRes.arrayBuffer();
          base64Data = Buffer.from(arrayBuffer).toString('base64');
        } catch (fetchErr) {
          console.error("Error fetching file from URL:", fetchErr);
          return res.status(400).json({ error: "Failed to fetch file from URL" });
        }
      }

      if (!base64Data) {
        return res.status(400).json({ error: "No PDF provided" });
      }

      const cvSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          full_name: { type: Type.STRING, nullable: true },
          phone: { type: Type.STRING, nullable: true },
          email: { type: Type.STRING, nullable: true },
          city: { type: Type.STRING, nullable: true },
          experience_total_years: { type: Type.NUMBER, nullable: true },
          relevant_experience_summary: { type: Type.STRING },
          education_summary: { type: Type.STRING },
          strengths_detected: { type: Type.ARRAY, items: { type: Type.STRING } },
          risk_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
          initial_score_1_to_5: { type: Type.NUMBER },
          recommendation: { type: Type.STRING, enum: ["advance", "review", "low_priority"] },
          justification: { type: Type.STRING }
        },
        required: ["relevant_experience_summary", "education_summary", "strengths_detected", "risk_flags", "initial_score_1_to_5", "recommendation", "justification"]
      };

      const prompt = `
      Eres un analista de reclutamiento asistido por IA dentro de un ATS.
      Tu rol es extraer, resumir y puntuar información de candidatos de forma estructurada a partir de su CV.
      El archivo adjunto puede ser un documento PDF, de Word o directamente una imagen/foto del currículum. Debes extraer el texto y analizarlo sin importar su formato de origen.
      No decides contrataciones finales.
      No afirmas diagnósticos psicológicos ni criminales.
      
      MUY IMPORTANTE:
      No extraigas ni asumas habilidades (skills) basadas únicamente en lo que el candidato escribe en su CV, ya que esto se evaluará posteriormente en la práctica mediante tests y entrevistas. Tu análisis debe centrarse en la experiencia demostrable, la educación, y las fortalezas o riesgos que se puedan deducir de su trayectoria.

      PUNTUACIÓN (ESTRELLAS):
      Califica el CV con una puntuación de estrellas desde 0.1 hasta 5.0 (ej. 3.5, 4.2, 4.8) en el campo 'initial_score_1_to_5'.
      Esta es una calificación preliminar basada únicamente en la estructura, experiencia demostrable y presentación del CV.

      Siempre devuelves JSON válido según el esquema entregado.
      Si faltan datos, lo indicas explícitamente en lugar de inventar.
      
      IMPORTANTE PARA EL TELÉFONO: Extrae el número de teléfono e incluye siempre el código de país. Si no lo tiene, asume +52. El formato ideal es solo números con el código de país (ej. +525551234567).
      
      Analiza el siguiente CV (que puede ser documento o imagen) y extrae la información solicitada.
      `;

      let contentsPart: any;
      if (mimeType.includes('wordprocessingml.document') || mimeType.includes('msword')) {
        contentsPart = { text: "Texto extraído del CV:\n" + (await mammoth.extractRawText({ buffer: Buffer.from(base64Data, 'base64') })).value };
      } else {
        contentsPart = { inlineData: { data: base64Data, mimeType: mimeType || 'application/pdf' } };
      }

      console.log(`[parse-cv] Sending request to Gemini... MimeType: ${mimeType}, Size: ${base64Data.length}`);

      const ai = getAI();
      if (!ai) {
        return res.status(400).json({ error: "CLAVE INVÁLIDA: Tienes configurada la clave 'MY_GEMINI_API_KEY' en la pestaña 'Secrets'. Para solucionar esto: 1) Haz clic en 'Settings' (arriba a la derecha), 2) Entra a 'Secrets', 3) Busca 'GEMINI_API_KEY' y elimínalo haciendo clic en el icono de bote de basura. Si haces esto usarás la IA gratuita automáticamente." });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [prompt, contentsPart],
        config: {
          responseMimeType: "application/json",
          responseSchema: cvSchema,
          temperature: 0.2
        }
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error("Empty response from Gemini");
      }

      const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
      const parsedData = JSON.parse(cleanJson);
      res.json(parsedData);

    } catch (error: any) {
      console.error("Error parsing CV:", error);
      const errorMessage = error.message || String(error);
      if (errorMessage.includes('CLAVE INVALIDA')) {
         res.status(400).json({ error: errorMessage });
      } else if (errorMessage.includes('API key not valid')) {
        res.status(400).json({ error: "API key not valid. Please configure a valid API key in Settings -> Secrets." });
      } else {
        res.status(500).json({ error: "Failed to parse CV", details: errorMessage });
      }
    }
  });

  // ============================================================================
  // AI Test Evaluation Endpoint
  // ============================================================================
  app.post("/api/evaluate-test", globalRateLimit(60), rateLimit(20), async (req, res) => {
    try {
      const { questions, answers } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "API key not configured" });
      }

      // Format the Q&A for the prompt
      const qaList = (questions || []).map((q: any) => {
        if (!q) return '';
        const qId = typeof q === 'string' ? q : q.id;
        const qText = typeof q === 'string' ? q : q.text;
        const rawA = answers[qId];
        const aText = Array.isArray(rawA) ? rawA.join(', ') : (rawA || 'No respondió');
        return `Pregunta: ${qText}\nRespuesta del candidato: ${aText}`;
      }).filter(Boolean).join('\n\n');

      const schema = {
        type: Type.OBJECT,
        properties: {
          score: {
            type: Type.NUMBER,
            description: "Calificación final del test de 0 a 100."
          },
          customer_service_score: {
            type: Type.NUMBER,
            description: "Calificación de Servicio al cliente de 0 a 20."
          },
          practical_intelligence_score: {
            type: Type.NUMBER,
            description: "Calificación de Inteligencia práctica de 0 a 20."
          },
          behavioral_fit_score: {
            type: Type.NUMBER,
            description: "Calificación de Ajuste conductual de 0 a 20."
          },
          stability_responsibility_score: {
            type: Type.NUMBER,
            description: "Calificación de Estabilidad y responsabilidad de 0 a 20."
          },
          improvement_desire_score: {
            type: Type.NUMBER,
            description: "Calificación de Deseo de mejora de 0 a 10."
          },
          orthography_score: {
            type: Type.NUMBER,
            description: "Calificación de ortografía y redacción de 0 a 10."
          },
          justification: {
            type: Type.STRING,
            description: "Análisis general del perfil psicológico y conductual mostrado en las respuestas (máximo 3 párrafos)."
          },
          red_flags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista de señales de alerta detectadas en las respuestas (si las hay)."
          },
          positive_signals: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista de señales positivas y fortalezas detectadas."
          },
          spelling_mistakes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista de palabras mal escritas o errores de puntuación (ej. 'llebo' en vez de 'llevo', falta de comas). NO incluyas faltas de tilde."
          },
          incorrect_answers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Lista de respuestas que fueron consideradas incorrectas, evasivas o negativas, con una breve explicación de por qué."
          }
        },
        required: ["score", "customer_service_score", "practical_intelligence_score", "behavioral_fit_score", "stability_responsibility_score", "improvement_desire_score", "orthography_score", "justification", "red_flags", "positive_signals", "spelling_mistakes", "incorrect_answers"]
      };

      const prompt = `
        Eres un psicólogo laboral experto y reclutador senior evaluando un Test Presencial para la empresa Darwin Cell.
        
        PERFIL BUSCADO:
        Buscamos personas cooperativas, entrenables, receptivas al feedback, que respeten los procesos, estables emocionalmente, orientadas al servicio, responsables y con deseo real de mejorar. NO buscamos perfiles "sumisos", sino colaboradores maduros.

        A continuación se presentan las respuestas de un candidato a una serie de pruebas cognitivas, de juicio situacional, personalidad laboral y honestidad:

        ${qaList}

        INSTRUCCIONES DE EVALUACIÓN:
        1. Analiza profundamente las respuestas en base a 6 dimensiones:
           - Servicio al cliente (20%): Empatía, trato, paciencia, orientación a ayudar.
           - Inteligencia práctica (20%): Comprensión, lógica, criterio, rapidez mental (evaluado principalmente en el Bloque A).
           - Ajuste conductual (20%): Disciplina, cooperación, reacción a correcciones.
           - Estabilidad y responsabilidad (20%): Madurez, permanencia, sentido de responsabilidad.
           - Deseo de mejora (10%): Aprendizaje, apertura al feedback, crecimiento.
           - Ortografía y Redacción (10%): 
             * REGLA CRÍTICA: IGNORA por completo la falta de tildes/acentos. No restes puntos por no poner tildes (ej. "papa" en vez de "papá" está BIEN).
             * REGLA CRÍTICA: IGNORA si el candidato inicia oraciones o párrafos con minúscula. No restes puntos por falta de mayúsculas iniciales.
             * SÍ penaliza la falta de comas o signos de puntuación necesarios.
             * SÍ penaliza el uso de letras incorrectas (ej. "llebo" en vez de "llevo", "hay" en vez de "ay").
             * Ejemplo de lo que está BIEN (10/10): "ay, pero mi papa me llevo a la escuela." (Faltan tildes y mayúsculas, pero letras y comas están bien).
             * Ejemplo de lo que está MAL: "hay, pero mi papa me llebo a la escuela." (Mal uso de 'hay' y 'llebo').
             * Ejemplo de lo que está MAL: "ay pero mi papa me llevo a la escuela." (Falta la coma después de 'ay').
        2. Detecta "Red Flags" (banderas rojas): Arrogancia, culpar a otros, agresividad, falta de paciencia, respuestas vacías o evasivas, resistencia a la autoridad/corrección, falta de honestidad.
        3. Detecta "Señales Positivas": Asume responsabilidad, busca soluciones, muestra empatía genuina con el cliente, acepta errores, respeta normas, integridad.
        4. Asigna una puntuación de 0 a 100 basada en qué tan bien se alinea con el perfil buscado, ponderando las dimensiones mencionadas.
        5. La justificación debe expresarse como señales, consistencia, criterio, ajuste conductual y necesidad de validación humana. No emitas diagnósticos clínicos ni conclusiones absolutas sobre honestidad o peligrosidad.

        REGLAS DE PUNTUACIÓN:
        - 90-100: Respuestas excepcionales, maduras, empáticas y resolutivas. Alta consistencia.
        - 70-89: Buenas respuestas, perfil adecuado y entrenable.
        - 50-69: Respuestas promedio, algunas dudas sobre su manejo de estrés, actitud o inteligencia práctica.
        - 0-49: Presencia de Red Flags graves (agresividad, evasión de responsabilidad, mala actitud, falta de integridad).

        Devuelve el resultado ESTRICTAMENTE en el formato JSON solicitado.
      `;

      const ai = getAI();
      if (!ai) {
        return res.status(400).json({ error: "CLAVE INVÁLIDA: Tienes configurada la clave 'MY_GEMINI_API_KEY' en la pestaña 'Secrets'. Para solucionar esto: 1) Haz clic en 'Settings' (arriba a la derecha), 2) Entra a 'Secrets', 3) Busca 'GEMINI_API_KEY' y elimínalo haciendo clic en el icono de bote de basura. Si haces esto usarás la IA gratuita automáticamente." });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.2, // Low temperature for more objective evaluation
        }
      });

      const resultText = response.text;
      if (!resultText) throw new Error("Empty response from Gemini");

      // Strip markdown code blocks if present
      const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
      const parsedResult = JSON.parse(cleanJson);
      res.json(parsedResult);

    } catch (error: any) {
      console.error("Error evaluating test:", error);
      res.status(500).json({ error: "Failed to evaluate test", details: error.message || String(error) });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: { port: 24682 }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  
  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.error('Address in use, retrying...');
      setTimeout(() => {
        server.close();
        server.listen(PORT, "0.0.0.0");
      }, 1000);
    }
  });
}

bootstrap();
