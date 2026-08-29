import React, { useEffect, useRef } from 'react';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch, requestCvWorkerRun } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { normalizePhone } from '../lib/phone';

// How often an open recruiter tab pokes the backend queue. Generous on purpose: this
// is a safety net for CVs the server's own triggers missed, not the main path — an
// application already kicks the worker the moment it arrives.
const HEARTBEAT_MS = 3 * 60 * 1000;

export default function CVWorker() {
  const { isRecruiter } = useAuth();
  const isRunning = useRef(false);
  const isPinging = useRef(false);

  useEffect(() => {
    // Only run the worker if the logged-in user is a recruiter
    if (!isRecruiter) return;

    let cancelled = false;
    let intervalId: any;

    const runWorker = async () => {
      if (isRunning.current) return;
      isRunning.current = true;
      try {
        const candidatesRef = collection(db, 'candidates');
        const qPending = query(candidatesRef, where('aiStatus', '==', 'pending'));
        const snapshot = await getDocs(qPending);
        
        if (snapshot.empty) return;

        const now = Date.now();
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();

          console.log(`[Frontend Worker] Analyzing candidate CV: ${docSnap.id}`);
          
          // Claim the task to avoid race conditions (since recruiter is authenticated, firestore rules allow this)
          await setDoc(doc(db, 'candidates', docSnap.id), { aiStatus: 'processing' }, { merge: true });

          try {
            // Call the backend securely, the backend will fetch and parse the PDF without needing Firebase auth
            const response = await apiFetch('/api/parse-cv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fileUrl: data.cvUrl,
                  mimeType: data.cvFileType || 'application/pdf'
                })
              });

              if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Parse CV API error: ${response.statusText}`);
              }

              const text = await response.text();
              let parsedData;
              try {
                parsedData = JSON.parse(text);
              } catch (e) {
                throw new Error(`Invalid JSON response: ${text.substring(0, 50)}...`);
              }

              // Determine updates for candidates table
              const candidateUpdatePayload: any = {
                aiExtraction: parsedData,
                aiStatus: 'completed'
              };

              // Bulk uploads: the AI fills only the EMPTY fields — data the recruiter
              // typed at upload time (name/phone/email/city) always wins.
              const namePending = data.fullName?.startsWith("Procesando:");
              if (namePending || data.source === 'bulk') {
                if (namePending && parsedData.full_name) candidateUpdatePayload.fullName = parsedData.full_name;
                if (!data.email && parsedData.email) candidateUpdatePayload.email = parsedData.email;
                if (!data.phone && parsedData.phone) {
                  candidateUpdatePayload.phone = parsedData.phone;
                  candidateUpdatePayload.phoneNormalized = normalizePhone(parsedData.phone);
                }
                if (!data.city && parsedData.city) candidateUpdatePayload.city = parsedData.city;
              }

              // Update candidate
              await setDoc(doc(db, 'candidates', docSnap.id), candidateUpdatePayload, { merge: true });

              // Update actual applications document (DO NOT CHANGE STAGE = NO WHATSAPP SENT)
              const appsRef = collection(db, 'applications');
              const appQ = query(appsRef, where('candidateId', '==', docSnap.id));
              const appsSnap = await getDocs(appQ);
              
              for (const appDoc of appsSnap.docs) {
                const appUpdatePayload: any = {
                  scoreSummary: parsedData.initial_score_1_to_5,
                  recommendation: parsedData.recommendation
                };
                if (namePending && parsedData.full_name) {
                  appUpdatePayload.candidateName = parsedData.full_name;
                }

                await setDoc(doc(db, 'applications', appDoc.id), appUpdatePayload, { merge: true });
              }

              console.log(`[Frontend Worker] Successfully scored candidate ${docSnap.id}: ${parsedData.initial_score_1_to_5} Stars`);

            } catch (aiError: any) {
               console.error(`[Frontend Worker] Error processing ${docSnap.id}:`, aiError);
               await setDoc(doc(db, 'candidates', docSnap.id), { 
                 aiStatus: 'error', 
                 aiError: aiError.message 
               }, { merge: true });
               
               // Inform the applications so the UI doesn't get stuck securely
               const appQ2 = query(collection(db, 'applications'), where('candidateId', '==', docSnap.id));
               const appsSnap2 = await getDocs(appQ2);
               for (const appDoc of appsSnap2.docs) {
                 if (data.fullName?.startsWith("Procesando:")) {
                   await setDoc(doc(db, 'applications', appDoc.id), { 
                     candidateName: `⚠️ Error de lectura: ${data.fullName.replace('Procesando: ', '')}` 
                   }, { merge: true });
                 }
               }
            }
        }
      } catch(e) {
        console.error("[Frontend Worker] Main loop error:", e);
      } finally {
        isRunning.current = false;
      }
    };

    // Ask the server to drain its queue. One request at a time: a drain can hold the
    // connection for minutes, so stacking pings would gain nothing (the server just
    // answers "busy" and returns).
    const heartbeat = async () => {
      if (isPinging.current) return;
      isPinging.current = true;
      try {
        await requestCvWorkerRun();
      } finally {
        isPinging.current = false;
      }
    };

    const start = async () => {
      // Does the backend own CV parsing? (Admin SDK credentials present.)
      let serverOwnsCvs = false;
      try {
        const health = await fetch('/api/health').then(r => r.json()).catch(() => ({}));
        serverOwnsCvs = !!health?.serverCvWorker;
      } catch { /* assume it doesn't, and parse in the browser below */ }
      if (cancelled) return;

      if (serverOwnsCvs) {
        // The browser must NOT parse too — two recruiters would double-process the same
        // CVs. It becomes a heartbeat instead: the server's 60s timer stalls whenever
        // the host throttles CPU between requests, so on a quiet day an open recruiter
        // tab is what keeps the queue moving. The request itself is what hands the
        // server the CPU to drain it.
        heartbeat();
        intervalId = setInterval(heartbeat, HEARTBEAT_MS);
        return;
      }

      // No admin credentials (dev): the browser parses the CVs itself, as before.
      runWorker();
      intervalId = setInterval(runWorker, 60 * 1000);
    };

    start();
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  }, [isRecruiter]);

  // This is a headless component, it renders nothing
  return null;
}
