import { normalizePhone } from './phone';
import { normalizeName } from './mergeCandidates';
import { PARTICLES, isPlaceholderName } from './personName';

/**
 * ¿La postulación que acaba de llegar es de alguien que YA está en la base?
 *
 * El navegador no es la identidad de nadie. `/api/apply` crea el candidato con el UID de
 * la sesión anónima, así que la misma persona aplicando otro día, desde otro teléfono o
 * en otro navegador nacía como un perfil nuevo — y con un test en cada perfil. Esto
 * decide, antes de escribir nada, si la postulación se cuelga del perfil que ya existe.
 *
 * El listón es alto a propósito: tienen que coincidir el TELÉFONO, el CORREO y el
 * NOMBRE. Compartir un celular es normal en una familia; compartir también el correo y
 * llamarse igual, no. Si algo no cuadra se crea un perfil aparte y queda para que una
 * persona lo revise en "Revisar duplicados": un perfil duplicado se arregla en dos
 * clics, mientras que mezclar a dos personas distintas no se deshace con un botón.
 */

export interface IncomingApplicant {
  name: string;
  /** Ya normalizado por quien llama (el servidor lo necesita de todas formas). */
  phoneNormalized: string;
  email: string;
}

export interface IdentityMatch {
  same: boolean;
  /** Qué coincidió, para dejarlo en el log del servidor. */
  reason: string;
}

/** Las palabras del nombre que de verdad identifican: sin partículas ("de", "la", "los"). */
export function nameTokens(raw: unknown): string[] {
  if (isPlaceholderName(String(raw ?? ''))) return [];
  return normalizeName(raw)
    .split(' ')
    .filter(t => t.length >= 2 && !PARTICLES.has(t));
}

/**
 * ¿Los dos nombres pueden ser de la misma persona?
 *
 * Sí cuando uno está contenido en el otro: "Ana Pérez" y "Ana María Pérez Gómez" es la
 * misma persona escribiendo su nombre con más o menos detalle. No cuando cada uno tiene
 * algo que el otro no ("Ana Pérez" y "Ana Gómez" son dos hermanas).
 *
 * Hacen falta al menos DOS palabras en los dos nombres. Con el nombre de pila solo,
 * "Ana" estaría contenido en "Ana Gómez" y bastaría saber el teléfono, el correo y el
 * nombre de pila de alguien para que una postulación nueva cayera en SU perfil. Quien
 * puso solo su nombre de pila la primera vez genera un perfil aparte, y eso se arregla
 * en dos clics desde "Revisar duplicados"; confundir a dos personas, no.
 */
export function namesCompatible(a: unknown, b: unknown): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const setA = new Set(ta);
  const setB = new Set(tb);
  return ta.every(t => setB.has(t)) || tb.every(t => setA.has(t));
}

/** Todos los teléfonos por los que conocemos a un perfil, en forma canónica. */
function phonesOf(candidate: any): string[] {
  const raw = [candidate?.phoneNormalized, candidate?.phone, ...(Array.isArray(candidate?.alternatePhones) ? candidate.alternatePhones : [])];
  return raw.filter(Boolean).map(p => normalizePhone(String(p))).filter(Boolean);
}

/** Todos sus correos, en minúsculas. */
function emailsOf(candidate: any): string[] {
  const raw = [candidate?.email, ...(Array.isArray(candidate?.alternateEmails) ? candidate.alternateEmails : [])];
  return raw.filter(Boolean).map(e => String(e).trim().toLowerCase()).filter(Boolean);
}

/**
 * ¿El perfil que ya existe es de esta misma persona, con certeza suficiente para
 * colgarle la postulación nueva sin preguntarle a nadie?
 */
export function isSameApplicant(existing: any, incoming: IncomingApplicant): IdentityMatch {
  // Un perfil ya unificado en otro no recibe nada: su contenido vive en el vivo.
  if (!existing || existing.mergedInto) return { same: false, reason: '' };

  const phone = normalizePhone(String(incoming?.phoneNormalized || ''));
  const email = String(incoming?.email || '').trim().toLowerCase();
  if (!phone || !email) return { same: false, reason: 'sin_telefono_o_correo' };

  if (!phonesOf(existing).includes(phone)) return { same: false, reason: 'telefono_distinto' };
  if (!emailsOf(existing).includes(email)) return { same: false, reason: 'correo_distinto' };
  if (!namesCompatible(existing.fullName || existing.name, incoming?.name)) {
    return { same: false, reason: 'nombre_distinto' };
  }
  return { same: true, reason: 'telefono+correo+nombre' };
}
