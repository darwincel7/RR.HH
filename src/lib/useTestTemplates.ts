import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { TEST_TEMPLATES_COLLECTION, normalizeTestTemplate, withDefaultTest, type TestTemplate } from './testTemplates';

/**
 * Live list of the tests presenciales (deleted/archived ones left out), general test first.
 * The general test is always in the list: until someone edits it, it lives only in code
 * (plus the questions saved in settings/forms), and the server resolves it the same way.
 */
export function useTestTemplates(): { templates: TestTemplate[]; loading: boolean; error: string } {
  const [docs, setDocs] = useState<TestTemplate[] | null>(null);
  // undefined = still loading; null = no settings/forms doc.
  const [forms, setForms] = useState<any>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'settings', 'forms'))
      .then(s => { if (!cancelled) setForms(s.exists() ? s.data() : null); })
      .catch(() => { if (!cancelled) setForms(null); });
    const unsub = onSnapshot(
      collection(db, TEST_TEMPLATES_COLLECTION),
      snap => {
        setDocs(snap.docs.map(d => normalizeTestTemplate(d.data(), d.id)).filter(t => !t.archived));
        setError('');
      },
      err => {
        console.error('Error cargando los tests presenciales:', err);
        setError('No se pudieron cargar los tests presenciales. Recarga la página; si sigue, revisa que las reglas de Firestore estén publicadas.');
        setDocs([]);
      },
    );
    return () => { cancelled = true; unsub(); };
  }, []);

  const loading = docs === null || forms === undefined;
  const templates = useMemo(() => (loading ? [] : withDefaultTest(docs || [], forms)), [loading, docs, forms]);
  return { templates, loading, error };
}
