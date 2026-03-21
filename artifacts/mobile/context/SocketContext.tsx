import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { AppState, AppStateStatus } from "react-native";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface TypingUser {
  userId: number;
  sessionId: number;
}

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  typingUsers: Map<number, Set<number>>;
  onlineUserIds: Set<number>;
  emitTypingStart: (sessionId: number) => void;
  emitTypingStop: (sessionId: number) => void;
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
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
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

    socket.on("presence_update", (data: { userId: number; status: string }) => {
      if (data.userId === user.id) return;
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.status === "online") {
          next.add(data.userId);
        } else {
          next.delete(data.userId);
        }
        return next;
      });
    });

    socket.on("messages_read", (data: { userId: number; sessionId: number }) => {
      queryClient.setQueryData(["messages", data.sessionId], (old: any[] = []) =>
        old.map((m) => {
          if (m.senderId === user.id && m.status !== "read") {
            return { ...m, status: "read" };
          }
          return m;
        })
      );
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

  const emitTypingStart = useCallback((sessionId: number) => {
    socketRef.current?.emit("typing_start", { sessionId });
  }, []);

  const emitTypingStop = useCallback((sessionId: number) => {
    socketRef.current?.emit("typing_stop", { sessionId });
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
        onlineUserIds,
        emitTypingStart,
        emitTypingStop,
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
