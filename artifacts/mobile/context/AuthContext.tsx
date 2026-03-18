import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("focus_user").then((raw) => {
      if (raw) {
        try {
          setUser(JSON.parse(raw));
        } catch {}
      }
      setIsLoading(false);
    });
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    const authUser: AuthUser = {
      id: data.id,
      username: data.username,
      name: data.name,
      token: data.token,
    };
    await AsyncStorage.setItem("focus_user", JSON.stringify(authUser));
    setUser(authUser);
  };

  const register = async (username: string, name: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, name, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    const authUser: AuthUser = {
      id: data.id,
      username: data.username,
      name: data.name,
      token: data.token,
    };
    await AsyncStorage.setItem("focus_user", JSON.stringify(authUser));
    setUser(authUser);
  };

  const logout = async () => {
    await AsyncStorage.removeItem("focus_user");
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
