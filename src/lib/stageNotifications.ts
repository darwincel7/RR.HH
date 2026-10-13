import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_WA_TEMPLATES } from './whatsappTemplates';

/**
 * Per-stage "notify the candidate when moved here" switch — one click on the stage's
 * column (Kanban) or its template (Configuración). OFF means a move to that stage sends
 * NOTHING automatically: no WhatsApp and no email. The move itself still happens.
 *
 * Stored in settings/stage_notifications as { off: { [stage]: true } }. Missing = ON,
 * so every stage keeps notifying exactly as before until someone switches it off.
 * The server enforces it too (/api/automations/stage-change), for screens opened
 * before the switch existed.
 */

export const STAGE_NOTIFICATIONS_PATH = ['settings', 'stage_notifications'] as const;

/** Stages handled in person: they never send automatically, whatever the settings say. */
export const NO_AUTOMATION_STAGES = ['Tests presenciales', 'Pruebas técnicas', 'Contratado'];

/** Can a move to this stage send a message at all (it has a template)? Only those get a switch. */
export function stageHasMessage(stage: string, customTemplates?: Record<string, unknown> | null): boolean {
  if (NO_AUTOMATION_STAGES.includes(stage)) return false;
  // Same rule as getStageTemplate: a blank configured template falls back to the default.
  const custom = customTemplates?.[stage];
  if (typeof custom === 'string' && custom.trim()) return true;
  return !!DEFAULT_WA_TEMPLATES[stage];
}

/** Is this stage's automatic message switched OFF in the given settings data? */
export function isStageMuted(settings: { off?: Record<string, unknown> } | null | undefined, stage: string): boolean {
  return settings?.off?.[stage] === true;
}

/**
 * Fresh read right before sending. If the settings can't be read the stage counts as
 * ON — the same outcome as before this switch existed.
 */
export async function isStageMutedNow(stage: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, ...STAGE_NOTIFICATIONS_PATH));
    return snap.exists() ? isStageMuted(snap.data() as any, stage) : false;
  } catch {
    return false;
  }
}
