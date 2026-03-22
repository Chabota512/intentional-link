import { useQuery } from "@tanstack/react-query";
import { useApi } from "./useApi";
import { useAuth } from "@/context/AuthContext";

interface Session {
  id: number;
  unreadCount?: number;
}

export function useUnreadCount(): number {
  const { get } = useApi();
  const { user } = useAuth();

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => get("/sessions"),
    refetchInterval: 5000,
    enabled: !!user,
    staleTime: 2000,
  });

  return sessions.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0);
}
