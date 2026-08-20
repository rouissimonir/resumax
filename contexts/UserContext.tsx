import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

type UserType = "guest" | "google";

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  picture?: string;
};

/**
 * Everything about the signed-in user that must survive an app restart.
 *
 * Before this existed, sign-in state lived only in React state: closing the
 * app dropped every user back to the login screen, and — because history is
 * scoped to whoever is signed in — silently detached them from their CVs.
 */
type PersistedAuth = {
  isAuthenticated: boolean;
  userType: UserType;
  userProfile: UserProfile | null;
  displayName: string;
  avatarUri: string;
};

const AUTH_KEY = "AUTH_STATE_V1";
const ONBOARDING_KEY = "HAS_SEEN_ONBOARDING";

const DEFAULT_AUTH: PersistedAuth = {
  isAuthenticated: false,
  userType: "guest",
  userProfile: null,
  displayName: "Resume User",
  avatarUri: "",
};

/**
 * Storage namespace for the *currently active* user.
 *
 * Anything user-owned (history today, more later) keys off this rather than a
 * fixed string, so two Google accounts on one shared device never see each
 * other's data, and signing out of an account doesn't expose its CVs to the
 * next guest.
 */
export function scopeForUser(
  userType: UserType,
  userProfile: UserProfile | null,
): string {
  return userType === "google" && userProfile?.id
    ? `u_${userProfile.id}`
    : "guest";
}

type UserContextType = {
  isAuthenticated: boolean;
  userType: UserType;
  userProfile: UserProfile | null;
  displayName: string;
  setDisplayName: (name: string) => void;
  avatarUri: string;
  setAvatarUri: (uri: string) => void;
  signInWithGoogle: (profile: UserProfile) => void;
  continueAsGuest: () => void;
  signOut: () => void;
  hasSeenOnboarding: boolean;
  isLoading: boolean;
  completeOnboarding: () => void;
  /** Namespace key for this user's stored data. See scopeForUser(). */
  storageScope: string;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<PersistedAuth>(DEFAULT_AUTH);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    try {
      // One multiGet rather than two awaits: this runs on the splash screen's
      // critical path, so every round trip is time the user spends staring at
      // a logo.
      const entries = await AsyncStorage.multiGet([
        ONBOARDING_KEY,
        AUTH_KEY,
      ]);
      const stored = Object.fromEntries(entries) as Record<
        string,
        string | null
      >;

      if (stored[ONBOARDING_KEY] !== null) {
        setHasSeenOnboarding(true);
      }

      const rawAuth = stored[AUTH_KEY];
      if (rawAuth) {
        // Spread over the defaults: a future build that adds a field must not
        // read `undefined` for it on an install that predates the field.
        setAuth({ ...DEFAULT_AUTH, ...JSON.parse(rawAuth) });
      }
    } catch (e) {
      // A corrupt store must not brick the app — falling through to defaults
      // just means the user sees the login screen again.
      console.error("Failed to restore session", e);
    } finally {
      setIsLoading(false);
    }
  };

  /** Update state and persist in one step so the two can never disagree. */
  const commit = async (updates: Partial<PersistedAuth>) => {
    const next = { ...auth, ...updates };
    setAuth(next);
    try {
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next));
    } catch (e) {
      console.error("Failed to persist session", e);
    }
  };

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      setHasSeenOnboarding(true);
    } catch (e) {
      console.error("Failed to save onboarding status", e);
    }
  };

  const signInWithGoogle = (profile: UserProfile) => {
    commit({
      isAuthenticated: true,
      userType: "google",
      userProfile: profile,
      displayName: profile.name,
      avatarUri: profile.picture || "",
    });
  };

  const continueAsGuest = () => {
    commit({
      isAuthenticated: true,
      userType: "guest",
      userProfile: null,
      displayName: "Guest User",
      avatarUri: "",
    });
  };

  const signOut = async () => {
    setAuth(DEFAULT_AUTH);
    try {
      // Remove rather than write the defaults back: a missing key and a
      // signed-out key mean the same thing, and this leaves nothing about the
      // previous account on disk.
      await AsyncStorage.removeItem(AUTH_KEY);
    } catch (e) {
      console.error("Failed to clear session", e);
    }
  };

  const setDisplayName = (name: string) => commit({ displayName: name });
  const setAvatarUri = (uri: string) => commit({ avatarUri: uri });

  return (
    <UserContext.Provider
      value={{
        isAuthenticated: auth.isAuthenticated,
        userType: auth.userType,
        userProfile: auth.userProfile,
        displayName: auth.displayName,
        setDisplayName,
        avatarUri: auth.avatarUri,
        setAvatarUri,
        signInWithGoogle,
        continueAsGuest,
        signOut,
        hasSeenOnboarding,
        isLoading,
        completeOnboarding,
        storageScope: scopeForUser(auth.userType, auth.userProfile),
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
