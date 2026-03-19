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

  const uploadFile = async (fileUri: string, fileName: string, fileSize: number, contentType: string): Promise<UploadedFile> => {
    const urlRes = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: fileName, size: fileSize, contentType }),
    });
    const urlData = await urlRes.json() as any;
    if (!urlRes.ok) throw new ApiError(urlData?.error || "Failed to get upload URL", urlRes.status);

    const { uploadURL, objectPath } = urlData;

    const fileRes = await fetch(fileUri);
    const blob = await fileRes.blob();

    const uploadRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!uploadRes.ok) throw new ApiError("Upload failed", uploadRes.status);

    return { objectPath, name: fileName, size: fileSize, contentType };
  };

  const getFileUrl = (objectPath: string): string => {
    return `${BASE_URL}/api/storage${objectPath}`;
  };

  return { get, post, put, patch, del, uploadFile, getFileUrl };
}
