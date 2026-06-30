import React, { useEffect, useRef } from 'react';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export default function CVWorker() {
  const { isRecruiter } = useAuth();
  const isRunning = useRef(false);

  useEffect(() => {
    // Only run the worker if the logged-in user is a recruiter
    if (!isRecruiter) return;

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

              // If it was a bulk upload (Procesando:...), overwrite the names and emails
              if (data.fullName?.startsWith("Procesando:")) {
                if (parsedData.full_name) candidateUpdatePayload.fullName = parsedData.full_name;
                if (parsedData.email) candidateUpdatePayload.email = parsedData.email;
                if (parsedData.phone) candidateUpdatePayload.phone = parsedData.phone;
                if (parsedData.city) candidateUpdatePayload.city = parsedData.city;
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
                if (data.fullName?.startsWith("Procesando:") && parsedData.full_name) {
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

    // Run once immediately, then every 60 seconds
    runWorker();
    const intervalId = setInterval(runWorker, 60 * 1000);

    return () => clearInterval(intervalId);
  }, [isRecruiter]);

  // This is a headless component, it renders nothing
  return null;
}
