import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken } from "./auth";
import { db, usersTable, sessionsTable, sessionParticipantsTable, sessionReadCursorsTable, messagesTable } from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";

let io: Server | null = null;

const onlineUsers = new Map<number, Set<string>>();

const typingTimers = new Map<string, NodeJS.Timeout>();

async function canAccessSession(sessionId: number, userId: number): Promise<boolean> {
  const [session] = await db.select({ creatorId: sessionsTable.creatorId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  if (!session) return false;
  if (session.creatorId === userId) return true;

  const [participant] = await db.select({ status: sessionParticipantsTable.status })
    .from(sessionParticipantsTable)
    .where(and(
      eq(sessionParticipantsTable.sessionId, sessionId),
      eq(sessionParticipantsTable.userId, userId)
    ))
    .limit(1);

  return participant?.status === "joined";
}

export function initSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token || typeof token !== "string") {
      return next(new Error("Authentication required"));
    }

    const userId = verifyToken(token);
    if (userId === null) {
      return next(new Error("Invalid token"));
    }

    socket.data.userId = userId;
    next();
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as number;
    console.log(`[Socket.IO] User ${userId} connected (${socket.id})`);

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);

    await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));

    await joinUserSessions(socket, userId);

    broadcastPresence(userId, "online");

    socket.on("join_session", async (sessionId: unknown) => {
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;
      const hasAccess = await canAccessSession(sessionId, userId);
      if (!hasAccess) return;
      socket.join(`session:${sessionId}`);
    });

    socket.on("leave_session", (sessionId: unknown) => {
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;
      socket.leave(`session:${sessionId}`);
    });

    socket.on("typing_start", async (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const { sessionId } = data as { sessionId?: unknown };
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;

      const hasAccess = await canAccessSession(sessionId, userId);
      if (!hasAccess) return;

      const key = `${userId}:${sessionId}`;

      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key)!);
      }

      socket.to(`session:${sessionId}`).emit("typing_start", {
        userId,
        sessionId,
      });

      typingTimers.set(
        key,
        setTimeout(() => {
          socket.to(`session:${sessionId}`).emit("typing_stop", {
            userId,
            sessionId,
          });
          typingTimers.delete(key);
        }, 5000)
      );
    });

    socket.on("typing_stop", async (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const { sessionId } = data as { sessionId?: unknown };
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;

      const hasAccess = await canAccessSession(sessionId, userId);
      if (!hasAccess) return;

      const key = `${userId}:${sessionId}`;

      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key)!);
        typingTimers.delete(key);
      }

      socket.to(`session:${sessionId}`).emit("typing_stop", {
        userId,
        sessionId,
      });
    });

    socket.on("mark_read", async (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const { sessionId } = data as { sessionId?: unknown };
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;

      const hasAccess = await canAccessSession(sessionId, userId);
      if (!hasAccess) return;

      const [latestMsg] = await db.select({ id: messagesTable.id })
        .from(messagesTable)
        .where(eq(messagesTable.sessionId, sessionId))
        .orderBy(desc(messagesTable.id))
        .limit(1);

      if (latestMsg) {
        await db.insert(sessionReadCursorsTable)
          .values({ sessionId, userId, lastReadMessageId: latestMsg.id, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [sessionReadCursorsTable.sessionId, sessionReadCursorsTable.userId],
            set: { lastReadMessageId: latestMsg.id, updatedAt: new Date() },
          });
      }

      socket.to(`session:${sessionId}`).emit("messages_read", {
        userId,
        sessionId,
      });
    });

    socket.on("disconnect", async () => {
      console.log(`[Socket.IO] User ${userId} disconnected (${socket.id})`);

      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
          broadcastPresence(userId, "offline");
        }
      }

      for (const [key, timer] of typingTimers.entries()) {
        if (key.startsWith(`${userId}:`)) {
          clearTimeout(timer);
          typingTimers.delete(key);
          const sid = parseInt(key.split(":")[1], 10);
          socket.to(`session:${sid}`).emit("typing_stop", {
            userId,
            sessionId: sid,
          });
        }
      }
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

export function isUserOnline(userId: number): boolean {
  const sockets = onlineUsers.get(userId);
  return !!sockets && sockets.size > 0;
}

export function emitToSession(sessionId: number, event: string, data: unknown): void {
  if (!io) return;
  io.to(`session:${sessionId}`).emit(event, data);
}

export function emitToUser(userId: number, event: string, data: unknown): void {
  if (!io) return;
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  for (const socketId of sockets) {
    io.to(socketId).emit(event, data);
  }
}

async function joinUserSessions(socket: Socket, userId: number): Promise<void> {
  const participantRows = await db
    .select({ sessionId: sessionParticipantsTable.sessionId })
    .from(sessionParticipantsTable)
    .where(
      and(
        eq(sessionParticipantsTable.userId, userId),
        eq(sessionParticipantsTable.status, "joined")
      )
    );

  const creatorRows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.creatorId, userId));

  const sessionIds = new Set([
    ...participantRows.map((r) => r.sessionId),
    ...creatorRows.map((r) => r.id),
  ]);

  for (const sessionId of sessionIds) {
    socket.join(`session:${sessionId}`);
  }
}

async function broadcastPresence(userId: number, status: "online" | "offline"): Promise<void> {
  if (!io) return;

  const participantRows = await db
    .select({ sessionId: sessionParticipantsTable.sessionId })
    .from(sessionParticipantsTable)
    .where(
      and(
        eq(sessionParticipantsTable.userId, userId),
        eq(sessionParticipantsTable.status, "joined")
      )
    );

  const creatorRows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.creatorId, userId));

  const sessionIds = new Set([
    ...participantRows.map((r) => r.sessionId),
    ...creatorRows.map((r) => r.id),
  ]);

  for (const sessionId of sessionIds) {
    io.to(`session:${sessionId}`).emit("presence_update", {
      userId,
      status,
      lastSeenAt: status === "offline" ? new Date().toISOString() : null,
    });
  }
}
