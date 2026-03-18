import { useQuery } from "@tanstack/react-query";
import { useApi } from "./useApi";
import { useAuth } from "@/context/AuthContext";

interface Participant {
  id: number;
  userId: number;
  status: string;
}

interface Session {
  id: number;
  status: string;
  participants: Participant[];
}

export function usePendingInvites(): number {
  const { get } = useApi();
  const { user } = useAuth();

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => get("/sessions"),
    refetchInterval: 10000,
    enabled: !!user,
    staleTime: 5000,
  });

  return sessions.filter((s) =>
    s.status === "active" &&
    s.participants.some((p) => p.userId === user?.id && p.status === "invited")
  ).length;
}
