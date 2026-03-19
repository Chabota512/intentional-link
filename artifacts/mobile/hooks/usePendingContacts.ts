import { useQuery } from "@tanstack/react-query";
import { useApi } from "./useApi";
import { useAuth } from "@/context/AuthContext";

interface ContactRequests {
  incoming: { id: number }[];
  outgoing: { id: number }[];
}

export function usePendingContacts(): number {
  const { get } = useApi();
  const { user } = useAuth();

  const { data } = useQuery<ContactRequests>({
    queryKey: ["contactRequests"],
    queryFn: () => get("/contacts/requests"),
    refetchInterval: 15000,
    enabled: !!user,
    staleTime: 10000,
  });

  return data?.incoming.length ?? 0;
}
