import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { apiClient, type AuthUser } from "./apiClient";
import { authErrorMessage } from "./authErrorMessage";
import { setActiveLocalAuthUserId } from "../../db/localAccount";
import { deleteLocalAccountData } from "../../db/deleteLocalAccountData";
import { subscribeToAppForegroundSync, synchronizePets, waitForPetSync } from "../sync/petSync";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  clearError(): void;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string): Promise<void>;
  logout(): Promise<void>;
  finishDeactivatedAccount(): Promise<void>;
  finishPermanentlyDeletedAccount(): Promise<boolean>;
  updateLocalUser(user: AuthUser): void;
  restore(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const restore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const restoredUser = await apiClient.restoreSession();
      setActiveLocalAuthUserId(restoredUser?.id ?? null);
      setUser(restoredUser);
    } catch (restoreError) {
      setActiveLocalAuthUserId(null);
      setError(authErrorMessage(restoreError));
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (!user) return;
    void synchronizePets().catch(() => undefined);
    const subscription = subscribeToAppForegroundSync();
    return () => subscription.remove();
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    await waitForPetSync();
    const authenticatedUser = await apiClient.login({ email, password });
    setActiveLocalAuthUserId(authenticatedUser.id);
    setUser(authenticatedUser);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      setError(null);
      await waitForPetSync();
      const authenticatedUser = await apiClient.register({ email, password, name });
      setActiveLocalAuthUserId(authenticatedUser.id);
      setUser(authenticatedUser);
    },
    [],
  );

  const logout = useCallback(async () => {
    setError(null);
    await waitForPetSync();
    try {
      await apiClient.logout();
    } catch (logoutError) {
      setError(
        `La sesión se cerró en este dispositivo, pero no pudimos completar el cierre de sesión. ${authErrorMessage(logoutError)}`,
      );
      throw logoutError;
    } finally {
      setActiveLocalAuthUserId(null);
      setUser(null);
    }
  }, []);

  const finishDeactivatedAccount = useCallback(async () => {
    try {
      await apiClient.clearLocalSession();
    } catch {
      // The server already revoked the account sessions; still leave the in-memory account.
    }
    setActiveLocalAuthUserId(null);
    setError(null);
    setUser(null);
  }, []);

  const finishPermanentlyDeletedAccount = useCallback(async (): Promise<boolean> => {
    await waitForPetSync();
    let localDataRemoved = false;
    try {
      if (user?.id) {
        await deleteLocalAccountData(user.id);
        localDataRemoved = true;
      }
    } catch {
      // The server request remains durable; report the local cleanup result to the caller.
    } finally {
      try { await apiClient.clearLocalSession(); } catch { /* Server sessions were already revoked. */ }
      setActiveLocalAuthUserId(null);
      setError(null);
      setUser(null);
    }
    return localDataRemoved;
  }, [user?.id]);

  const updateLocalUser = useCallback((updatedUser: AuthUser) => {
    setUser(updatedUser);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      clearError: () => setError(null),
      login,
      register,
      logout,
      finishDeactivatedAccount,
      finishPermanentlyDeletedAccount,
      updateLocalUser,
      restore,
    }),
    [user, loading, error, login, register, logout, finishDeactivatedAccount, finishPermanentlyDeletedAccount, updateLocalUser, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
