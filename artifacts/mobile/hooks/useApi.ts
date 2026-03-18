import { useAuth } from "@/context/AuthContext";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export function useApi() {
  const { user } = useAuth();

  const headers = () => ({
    "Content-Type": "application/json",
    "x-user-id": user ? String(user.id) : "",
    ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}),
  });

  const get = async (path: string) => {
    const res = await fetch(`${BASE_URL}/api${path}`, { headers: headers() });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error || "Request failed", res.status);
    return data;
  };

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "POST",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error || "Request failed", res.status);
    return data;
  };

  const put = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "PUT",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error || "Request failed", res.status);
    return data;
  };

  const patch = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "PATCH",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error || "Request failed", res.status);
    return data;
  };

  const del = async (path: string) => {
    const res = await fetch(`${BASE_URL}/api${path}`, { method: "DELETE", headers: headers() });
    if (!res.ok) {
      const data = await res.json();
      throw new ApiError(data.error || "Request failed", res.status);
    }
  };

  return { get, post, put, patch, del };
}
