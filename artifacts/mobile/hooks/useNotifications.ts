import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "./useApi";

export interface AppNotification {
  id: number;
  type: "message" | "call" | "invite" | "contact_request" | "contact_accepted" | "dnd_ending" | "chat_completed";
  title: string;
  body: string;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export function useNotifications() {
  const { get } = useApi();
  return useQuery<{ notifications: AppNotification[]; unreadCount: number }>({
    queryKey: ["notifications"],
    queryFn: () => get("/notifications"),
    staleTime: 30_000,
  });
}

export function useUnreadNotifCount() {
  const { data } = useNotifications();
  return data?.unreadCount ?? 0;
}

export function useMarkNotifRead() {
  const { post } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => post(`/notifications/${id}/read`, {}),
    onSuccess: (_, id) => {
      queryClient.setQueryData(["notifications"], (old: any) => {
        if (!old) return old;
        const notifications = old.notifications.map((n: AppNotification) =>
          n.id === id ? { ...n, isRead: true } : n
        );
        return { notifications, unreadCount: notifications.filter((n: AppNotification) => !n.isRead).length };
      });
    },
  });
}

export function useMarkAllNotifsRead() {
  const { post } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => post("/notifications/read-all", {}),
    onSuccess: () => {
      queryClient.setQueryData(["notifications"], (old: any) => {
        if (!old) return old;
        const notifications = old.notifications.map((n: AppNotification) => ({ ...n, isRead: true }));
        return { notifications, unreadCount: 0 };
      });
    },
  });
}
