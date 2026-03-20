import { Platform } from "react-native";
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

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      res.ok ? "Unexpected server response" : `Server error (${res.status})`,
      res.status
    );
  }
}

export interface UploadedFile {
  objectPath: string;
  url: string;
  name: string;
  size: number;
  contentType: string;
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
    const data = await safeJson(res) as any;
    if (!res.ok) throw new ApiError(data?.error || "Request failed", res.status);
    return data;
  };

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "POST",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await safeJson(res) as any;
    if (!res.ok) throw new ApiError(data?.error || "Request failed", res.status);
    return data;
  };

  const put = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "PUT",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await safeJson(res) as any;
    if (!res.ok) throw new ApiError(data?.error || "Request failed", res.status);
    return data;
  };

  const patch = async (path: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method: "PATCH",
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await safeJson(res) as any;
    if (!res.ok) throw new ApiError(data?.error || "Request failed", res.status);
    return data;
  };

  const del = async (path: string) => {
    const res = await fetch(`${BASE_URL}/api${path}`, { method: "DELETE", headers: headers() });
    if (!res.ok) {
      const data = await safeJson(res) as any;
      throw new ApiError(data?.error || "Request failed", res.status);
    }
  };

  const uploadFile = async (
    fileUri: string,
    fileName: string,
    fileSize: number,
    contentType: string
  ): Promise<UploadedFile> => {
    const formData = new FormData();

    if (Platform.OS === "web") {
      const response = await fetch(fileUri);
      const blob = await response.blob();
      formData.append("file", blob, fileName);
    } else {
      const fileBlob = {
        uri: fileUri,
        name: fileName,
        type: contentType,
      } as any;
      formData.append("file", fileBlob);
    }

    const authHeaders: Record<string, string> = {
      "x-user-id": user ? String(user.id) : "",
      ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}),
    };

    const res = await fetch(`${BASE_URL}/api/storage/upload`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });
    const data = await safeJson(res) as any;
    if (!res.ok) throw new ApiError(data?.error || "Upload failed", res.status);

    return {
      objectPath: data.url,
      url: data.url,
      name: fileName,
      size: fileSize,
      contentType,
    };
  };

  const getFileUrl = (objectPath: string): string => {
    if (objectPath.startsWith("http")) return objectPath;
    if (objectPath.startsWith("/api")) return `${BASE_URL}${objectPath}`;
    return `${BASE_URL}/api/storage${objectPath}`;
  };

  return { get, post, put, patch, del, uploadFile, getFileUrl };
}
