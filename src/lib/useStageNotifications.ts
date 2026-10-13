import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';
import { STAGE_NOTIFICATIONS_PATH, isStageMuted, stageHasMessage } from './stageNotifications';

/**
 * Live view of the per-stage notification switches (see stageNotifications.ts): the
 * Kanban columns and the template editor show the same state, and a click anywhere is
 * reflected everywhere at once (also on other recruiters' screens).
 */
export function useStageNotifications() {
  const [settings, setSettings] = useState<{ off?: Record<string, unknown> } | null>(null);
  const [customTemplates, setCustomTemplates] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const unsubSwitches = onSnapshot(
      doc(db, ...STAGE_NOTIFICATIONS_PATH),
      snap => { setSettings(snap.exists() ? (snap.data() as any) : {}); setLoaded(true); },
      () => setLoaded(true), // unreadable: every stage shows as ON (the default)
    );
    const unsubTemplates = onSnapshot(
      doc(db, 'settings', 'whatsapp_templates'),
      snap => setCustomTemplates(snap.exists() ? (snap.data()?.templates || null) : null),
      () => { /* defaults only */ },
    );
    return () => { unsubSwitches(); unsubTemplates(); };
  }, []);

  const isMuted = useCallback((stage: string) => isStageMuted(settings, stage), [settings]);
  const hasMessage = useCallback((stage: string) => stageHasMessage(stage, customTemplates), [customTemplates]);

  /** Flip one stage. Resolves to an error text, or null when saved. */
  const toggle = useCallback(async (stage: string): Promise<string | null> => {
    const next = !isStageMuted(settings, stage);
    setSaving(stage);
    // Optimistic: the switch moves at once; the live listener confirms (or reverts).
    setSettings(prev => ({ ...(prev || {}), off: { ...(prev?.off || {}), [stage]: next } }));
    try {
      await setDoc(doc(db, ...STAGE_NOTIFICATIONS_PATH), {
        off: { [stage]: next },
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || null,
      }, { merge: true });
      return null;
    } catch {
      setSettings(prev => ({ ...(prev || {}), off: { ...(prev?.off || {}), [stage]: !next } }));
      return 'No se pudo guardar el cambio. Revisa tu conexión e inténtalo de nuevo.';
    } finally {
      setSaving(null);
    }
  }, [settings]);

  return { loaded, isMuted, hasMessage, toggle, saving };
}
