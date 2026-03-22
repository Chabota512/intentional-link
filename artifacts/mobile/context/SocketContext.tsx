import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { AppState, AppStateStatus, Alert } from "react-native";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface TypingUser {
  userId: number;
  sessionId: number;
}

export interface PresenceDialogData {
  presenceVisibility: "all" | "specific" | "none";
  readReceiptsEnabled: boolean;
  whitelistedContactIds: number[];
}

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  typingUsers: Map<number, Set<number>>;
  recordingUsers: Map<number, Set<number>>;
  onlineUserIds: Set<number>;
  dndUserIds: Set<number>;
  unreadNotifCount: number;
  presenceDialogData: PresenceDialogData | null;
  dismissPresenceDialog: () => void;
  emitTypingStart: (sessionId: number) => void;
  emitTypingStop: (sessionId: number) => void;
  emitRecordingStart: (sessionId: number) => void;
  emitRecordingStop: (sessionId: number) => void;
  emitMarkRead: (sessionId: number) => void;
  joinSession: (sessionId: number) => void;
  leaveSession: (sessionId: number) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<number, Set<number>>>(new Map());
  const [recordingUsers, setRecordingUsers] = useState<Map<number, Set<number>>>(new Map());
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const [dndUserIds, setDndUserIds] = useState<Set<number>>(new Set());
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [presenceDialogData, setPresenceDialogData] = useState<PresenceDialogData | null>(null);
  const appStateRef = useRef<AppStateStatus>("active");

  useEffect(() => {
    if (!user?.token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    const socket = io(BASE_URL, {
      path: "/api/socket.io",
      auth: { token: user.token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("new_message", (message: any) => {
      if (message.senderId === user.id) return;
      const sessionId = message.sessionId;
      queryClient.setQueryData(["messages", sessionId], (old: any[] = []) => {
        if (old.some((m) => m.id === message.id)) return old;
        return [...old, message];
      });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    });

    socket.on("message_status_update", (data: any) => {
      const { messageIds, status, sessionId } = data;
      if (sessionId && Array.isArray(messageIds)) {
        const idSet = new Set(messageIds);
        queryClient.setQueryData(["messages", sessionId], (old: any[] = []) =>
          old.map((m) => (idSet.has(m.id) ? { ...m, status } : m))
        );
      }
    });

    socket.on("message_deleted", (data: any) => {
      const { sessionId, messageId } = data;
      queryClient.setQueryData(["messages", sessionId], (old: any[] = []) =>
        old.filter((m) => m.id !== messageId)
      );
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    });

    socket.on("reaction_added", (data: any) => {
      const { messageId, sessionId, emoji, userId: reactUserId } = data;
      queryClient.setQueryData(["messages", sessionId], (old: any[] = []) =>
        old.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = [...(m.reactions || [])];
          const existing = reactions.find((r: any) => r.emoji === emoji);
          if (existing) {
            if (!existing.userIds.includes(reactUserId)) {
              existing.count += 1;
              existing.userIds = [...existing.userIds, reactUserId];
            }
          } else {
            reactions.push({ emoji, count: 1, userIds: [reactUserId] });
          }
          return { ...m, reactions };
        })
      );
    });

    socket.on("reaction_removed", (data: any) => {
      const { messageId, sessionId, emoji, userId: reactUserId } = data;
      queryClient.setQueryData(["messages", sessionId], (old: any[] = []) =>
        old.map((m) => {
          if (m.id !== messageId) return m;
          let reactions = [...(m.reactions || [])];
          const existing = reactions.find((r: any) => r.emoji === emoji);
          if (existing) {
            existing.userIds = existing.userIds.filter((id: number) => id !== reactUserId);
            existing.count = existing.userIds.length;
            if (existing.count <= 0) {
              reactions = reactions.filter((r: any) => r.emoji !== emoji);
            }
          }
          return { ...m, reactions };
        })
      );
    });

    socket.on("typing_start", (data: TypingUser) => {
      if (data.userId === user.id) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(data.sessionId) || []);
        set.add(data.userId);
        next.set(data.sessionId, set);
        return next;
      });
    });

    socket.on("typing_stop", (data: TypingUser) => {
      if (data.userId === user.id) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(data.sessionId) || []);
        set.delete(data.userId);
        if (set.size === 0) {
          next.delete(data.sessionId);
        } else {
          next.set(data.sessionId, set);
        }
        return next;
      });
    });

    socket.on("recording_start", (data: TypingUser) => {
      if (data.userId === user.id) return;
      setRecordingUsers((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(data.sessionId) || []);
        set.add(data.userId);
        next.set(data.sessionId, set);
        return next;
      });
    });

    socket.on("recording_stop", (data: TypingUser) => {
      if (data.userId === user.id) return;
      setRecordingUsers((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(data.sessionId) || []);
        set.delete(data.userId);
        if (set.size === 0) {
          next.delete(data.sessionId);
        } else {
          next.set(data.sessionId, set);
        }
        return next;
      });
    });

    socket.on("presence_update", (data: { userId: number; status: string; isDndActive?: boolean }) => {
      if (data.userId === user.id) return;
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.status === "online") next.add(data.userId); else next.delete(data.userId);
        return next;
      });
      setDndUserIds((prev) => {
        const next = new Set(prev);
        if (data.isDndActive) next.add(data.userId); else next.delete(data.userId);
        return next;
      });
    });

    socket.on("call_blocked_dnd", (data: { userId: number; message: string }) => {
      Alert.alert("Do Not Disturb", data.message ?? "This contact is in Do Not Disturb mode and cannot receive calls right now.");
    });

    socket.on("messages_read", (_data: { userId: number; sessionId: number }) => {
    });

    socket.on("session_deleted", (data: { sessionId: number }) => {
      queryClient.setQueryData(["sessions"], (old: any) => {
        if (!old) return old;
        return old.filter((s: any) => s.id !== data.sessionId);
      });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    });

    socket.on("participant_left", (data: { sessionId: number; userId: number }) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["messages", data.sessionId] });
    });

    socket.on("show_presence_dialog", (data: PresenceDialogData) => {
      setPresenceDialogData(data);
    });

    socket.on("new_notification", (notif: any) => {
      queryClient.setQueryData(["notifications"], (old: any) => {
        const notifications = [notif, ...(old?.notifications ?? [])];
        const unreadCount = notifications.filter((n: any) => !n.isRead).length;
        return { notifications, unreadCount };
      });
      setUnreadNotifCount((prev) => prev + 1);
    });

    socket.on("contact_request_received", () => {
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    socket.on("contact_accepted", () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    socket.on("contact_declined", () => {
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    socket.on("session_invite", () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    const appStateSub = AppState.addEventListener("change", (state) => {
      appStateRef.current = state;
      if (state === "active" && !socket.connected) {
        socket.connect();
      }
    });

    return () => {
      appStateSub.remove();
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user?.token, user?.id]);

  const dismissPresenceDialog = useCallback(() => {
    setPresenceDialogData(null);
  }, []);

  const emitTypingStart = useCallback((sessionId: number) => {
    socketRef.current?.emit("typing_start", { sessionId });
  }, []);

  const emitTypingStop = useCallback((sessionId: number) => {
    socketRef.current?.emit("typing_stop", { sessionId });
  }, []);

  const emitRecordingStart = useCallback((sessionId: number) => {
    socketRef.current?.emit("recording_start", { sessionId });
  }, []);

  const emitRecordingStop = useCallback((sessionId: number) => {
    socketRef.current?.emit("recording_stop", { sessionId });
  }, []);

  const emitMarkRead = useCallback((sessionId: number) => {
    socketRef.current?.emit("mark_read", { sessionId });
  }, []);

  const joinSession = useCallback((sessionId: number) => {
    socketRef.current?.emit("join_session", sessionId);
  }, []);

  const leaveSession = useCallback((sessionId: number) => {
    socketRef.current?.emit("leave_session", sessionId);
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket: socketRef.current,
        isConnected,
        typingUsers,
        recordingUsers,
        onlineUserIds,
        dndUserIds,
        unreadNotifCount,
        presenceDialogData,
        dismissPresenceDialog,
        emitTypingStart,
        emitTypingStop,
        emitRecordingStart,
        emitRecordingStop,
        emitMarkRead,
        joinSession,
        leaveSession,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within SocketProvider");
  return ctx;
}
