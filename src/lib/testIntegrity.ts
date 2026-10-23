/**
 * Registro de integridad del Test de Juicio Situacional presencial.
 *
 * El test se responde en un teléfono de la empresa, sin corrector y sin IA a mano. La
 * página no puede impedir que alguien salga a otra app, pero sí puede notarlo: cuenta las
 * veces que la pantalla del test dejó de verse (cambiar de app o de pestaña, bloquear el
 * teléfono, recargar) con el tiempo que estuvo fuera, y bloquea —contándolos— los
 * intentos de pegar texto. Lo manda junto a las respuestas y el perfil lo muestra al lado
 * del resultado. Es una señal para conversar, no una prueba: que la pantalla se apague
 * por inactividad también cuenta como una salida, y por eso se muestra el tiempo fuera.
 */

export interface TestIntegrity {
  /** Veces que la pantalla del test dejó de verse mientras se respondía. */
  exits: number;
  /** Tiempo total fuera de la pantalla del test. */
  awayMs: number;
  /** Intentos de pegar (o dictar) texto, todos bloqueados. */
  pasteBlocked: number;
  /** De "Comenzar test" al envío. */
  durationMs: number;
}

export const EMPTY_INTEGRITY: TestIntegrity = { exits: 0, awayMs: 0, pasteBlocked: 0, durationMs: 0 };

/**
 * Lo más que entra de un solo golpe tecleando: una palabra larga deslizada en el teclado
 * ("responsabilidades") con su espacio. Un salto mayor es texto pegado, incluido el que el
 * teclado inserta desde su propio portapapeles o el dictado por voz, que no disparan el
 * evento `paste`.
 */
export const MAX_TYPED_INSERT = 20;

/** ¿Este cambio del campo metió de golpe más texto del que se puede teclear? */
export function isPastedInsert(prev: string, next: string): boolean {
  return next.length - prev.length > MAX_TYPED_INSERT;
}

/** "menos de 1 s", "45 s", "2 min 10 s", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const s = Math.floor((Number(ms) || 0) / 1000);
  if (s < 1) return 'menos de 1 s';
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  const rest = s % 60;
  return rest > 0 ? `${m} min ${rest} s` : `${m} min`;
}

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

export interface IntegrityReading {
  /** Ni salió de la pantalla ni intentó pegar. */
  clean: boolean;
  /** Lo que el reclutador debe saber, en frases. */
  lines: string[];
  /** "Duración: 18 min", o '' si no se registró. */
  duration: string;
}

/** Lo que se muestra en el perfil. null = el test se hizo antes de que existiera el registro. */
export function readIntegrity(raw: unknown): IntegrityReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const exits = count(r.exits);
  const awayMs = count(r.awayMs);
  const pasteBlocked = count(r.pasteBlocked);
  const durationMs = count(r.durationMs);
  const lines: string[] = [];
  if (exits > 0) {
    lines.push(`Salió de la pantalla del test ${exits} ${exits === 1 ? 'vez' : 'veces'} (${formatDuration(awayMs)} fuera en total).`);
  }
  if (pasteBlocked > 0) {
    lines.push(`Intentó pegar o dictar texto ${pasteBlocked} ${pasteBlocked === 1 ? 'vez' : 'veces'} (bloqueado).`);
  }
  return {
    clean: lines.length === 0,
    lines,
    duration: durationMs > 0 ? `Duración: ${formatDuration(durationMs)}` : '',
  };
}
