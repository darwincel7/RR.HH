import { doc, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { resolveScorecardTemplate, type BankEdit } from './interviewScorecard';

/**
 * Applies ONE edit to the shared interview question bank (settings/forms →
 * scorecard.recommendedQuestions) inside a transaction, against the bank as it is NOW in
 * Firestore rather than the copy this screen loaded — two recruiters editing questions at
 * the same time can't silently undo each other's change.
 *
 * Always returns the bank as it ends up (the current one when the edit is refused), so
 * the caller's copy also picks up whatever colleagues changed in the meantime. Only the
 * bank field is written (merge): the signals, red flags and metrics configured in
 * Formularios are never touched from here.
 */
export async function updateQuestionBank(edit: (bank: string[]) => BankEdit): Promise<{ bank: string[]; error?: string }> {
  const ref = doc(db, 'settings', 'forms');
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = resolveScorecardTemplate(snap.exists() ? snap.data()?.scorecard : null).recommendedQuestions;
    const result = edit(current);
    if ('error' in result) return { bank: current, error: result.error };
    tx.set(ref, { scorecard: { recommendedQuestions: result.bank } }, { merge: true });
    return { bank: result.bank };
  });
}
