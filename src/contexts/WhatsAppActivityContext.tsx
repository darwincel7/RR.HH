import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { WA_ACTIVITY_CHANGED_EVENT, type ActivityData } from '../lib/whatsappActivity';

/**
 * One shared view of the WhatsApp queue for the whole staff app: the side panel and
 * every candidate card read the same snapshot instead of each polling on its own.
 *
 * Polls every 20s while the tab is visible (the server answers from memory unless
 * something changed), refreshes at once when this app queues a message, and pauses
 * while the tab is hidden.
 */

interface WhatsAppActivityValue {
  data: ActivityData | null;
  /** Re-fetch now. */
  refresh: () => Promise<void>;
  /** Put a failed message back in line. Resolves to an error text, or null on success. */
  retry: (id: string) => Promise<string | null>;
  /** Remove a failed message from the list (it won't be sent). */
  dismiss: (id: string) => Promise<string | null>;
  /** Ids with a retry/dismiss in flight (to show a spinner on that button). */
  busy: Set<string>;
}

const Ctx = createContext<WhatsAppActivityValue | null>(null);

const POLL_MS = 20_000;

export function WhatsAppActivityProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    // One request at a time; a refresh asked for meanwhile (e.g. right after a retry)
    // runs once the current one ends, so it never reads a snapshot from before the change.
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        try {
          const res = await apiFetch('/api/whatsapp/activity');
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            setData(await res.json());
          }
        } catch {
          // Offline or server restarting: keep showing the last snapshot.
        }
      } while (again.current);
    })();
    inFlight.current = run;
    try { await run; } finally { inFlight.current = null; }
  }, []);

  useEffect(() => {
    refresh();
    let timer: number | undefined;
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState === 'visible') timer = window.setInterval(refresh, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
      schedule();
    };
    // A message was just queued from this tab: show it in a moment (the server needs
    // a beat to persist it).
    let soon: number | undefined;
    const onChanged = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(refresh, 800);
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(WA_ACTIVITY_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(soon);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(WA_ACTIVITY_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  const act = useCallback(async (id: string, action: 'retry' | 'dismiss'): Promise<string | null> => {
    setBusy(prev => new Set(prev).add(id));
    try {
      const res = await apiFetch('/api/whatsapp/outbox/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any));
        return d?.error || 'No se pudo completar la acción.';
      }
      return null;
    } catch {
      return 'No se pudo completar la acción (sin conexión).';
    } finally {
      await refresh();
      setBusy(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [refresh]);

  const value = useMemo<WhatsAppActivityValue>(() => ({
    data,
    refresh,
    retry: (id) => act(id, 'retry'),
    dismiss: (id) => act(id, 'dismiss'),
    busy,
  }), [data, refresh, act, busy]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null outside the staff layout (e.g. public pages) — callers render nothing then. */
export function useWhatsAppActivity(): WhatsAppActivityValue | null {
  return useContext(Ctx);
}
