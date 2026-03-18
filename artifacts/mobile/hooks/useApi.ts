import { useAuth } from "@/context/AuthContext";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export function useApi() {
  const { user } = useAuth();

  const headers = () => ({
    "Content-Type": "application/json",
    "x-user-id": user ? String(user.id) : "",
  });

  const get = async (path: string) => {
    const res = await fetch(`${BASE_URL}/api${path}`, { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "POST",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const patch = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "PATCH",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const del = async (path: string) => {
    const res = await fetch(`${BASE_URL}/api${path}`, { method: "DELETE", headers: headers() });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Request failed");
    }
  };

  return { get, post, patch, del };
}
