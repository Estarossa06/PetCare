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

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  clearError(): void;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string): Promise<void>;
  logout(): Promise<void>;
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
      setUser(await apiClient.restoreSession());
    } catch (restoreError) {
      setError(authErrorMessage(restoreError));
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setUser(await apiClient.login({ email, password }));
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      setError(null);
      setUser(await apiClient.register({ email, password, name }));
    },
    [],
  );

  const logout = useCallback(async () => {
    setError(null);
    try {
      await apiClient.logout();
    } finally {
      setUser(null);
    }
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
      restore,
    }),
    [user, loading, error, login, register, logout, restore],
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
