import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch or create user document
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          setUserData(userSnap.data());
        } else {
          // New sign-ins start with NO role: they land in a "pending" state until an
          // admin approves them from Settings. Previously every Google account was
          // auto-granted 'recruiter', which let anyone into the console.
          const newUserData = {
            uid: currentUser.uid,
            name: currentUser.displayName || 'Unknown',
            email: currentUser.email || '',
            roleIds: [] as string[],
            status: 'pending'
          };
          try {
            await setDoc(userRef, newUserData);
          } catch (e) {
            // Non-fatal: the pending screen still renders from the derived roles.
            console.warn('Could not create pending user doc:', e);
          }
          setUserData(newUserData);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
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
