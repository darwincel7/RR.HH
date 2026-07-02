import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  userData: any | null;
  loading: boolean;
  isRecruiter: boolean;
  isAdmin: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

// Kept in sync with the hardcoded fallback admin in firestore.rules.
const ADMIN_EMAILS = ['daruingmejia@gmail.com'];

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubUser: () => void = () => {};
    // Guards against re-entrancy: if a newer auth event fires while an older one is
    // still awaiting getDoc/setDoc, the stale invocation bails instead of attaching
    // a leaked listener to the previous user's doc.
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const gen = ++generation;
      unsubUser();          // tear down any previous user-doc listener
      unsubUser = () => {};
      setUser(currentUser);

      if (!currentUser) {
        setUserData(null);
        setLoading(false);
        return;
      }

      const userRef = doc(db, 'users', currentUser.uid);
      // Create a "pending" doc on first sign-in (no role until an admin approves).
      // Previously every Google account was auto-granted 'recruiter'.
      try {
        const snap = await getDoc(userRef);
        if (gen !== generation) return; // superseded by a newer auth event
        if (!snap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            name: currentUser.displayName || 'Unknown',
            email: currentUser.email || '',
            roleIds: [] as string[],
            status: 'pending',
          });
        }
      } catch (e) {
        console.warn('Could not initialize user doc:', e);
      }
      if (gen !== generation) return; // superseded while awaiting

      // Live-subscribe so approvals/revocations take effect without a manual reload.
      unsubUser = onSnapshot(
        userRef,
        (s) => { if (gen === generation) { setUserData(s.exists() ? s.data() : null); setLoading(false); } },
        (err) => { console.error('user snapshot error:', err); setLoading(false); }
      );
    });

    return () => { unsubUser(); unsubscribe(); };
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  const email = (user?.email || '').toLowerCase();
  const roleIds: string[] = Array.isArray(userData?.roleIds) ? userData.roleIds : [];
  const isAdmin = roleIds.includes('admin') || ADMIN_EMAILS.includes(email);
  const isRecruiter = isAdmin || roleIds.includes('recruiter');

  return (
    <AuthContext.Provider value={{ user, userData, loading, isRecruiter, isAdmin, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
