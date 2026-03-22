import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyToken } from "./auth";
import { db, usersTable, sessionsTable, sessionParticipantsTable, sessionReadCursorsTable, messagesTable, userPrivacySettingsTable, presenceWhitelistTable, userDndSettingsTable } from "@workspace/db";
import { eq, and, ne, desc, lte, inArray } from "drizzle-orm";

const DEFAULT_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

let io: Server | null = null;

const onlineUsers = new Map<number, Set<string>>();

const typingTimers = new Map<string, NodeJS.Timeout>();
const recordingTimers = new Map<string, NodeJS.Timeout>();

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
    path: "/api/socket.io",
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

    const [prevUser] = await db
      .select({ lastSeenAt: usersTable.lastSeenAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const prevLastSeenAt = prevUser?.lastSeenAt ?? null;

    const [privForThreshold] = await db
      .select({ offlineThresholdMinutes: userPrivacySettingsTable.offlineThresholdMinutes })
      .from(userPrivacySettingsTable)
      .where(eq(userPrivacySettingsTable.userId, userId))
      .limit(1);

    const thresholdMs = ((privForThreshold?.offlineThresholdMinutes ?? 5)) * 60 * 1000;

    const wasOfflineLong = prevLastSeenAt
      ? Date.now() - new Date(prevLastSeenAt).getTime() > thresholdMs
      : true;

    await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));

    await joinUserSessions(socket, userId);

    broadcastPresence(userId, "online", prevLastSeenAt);
    syncPresenceToNewUser(userId);

    if (wasOfflineLong) {
      const [privSettings] = await db
        .select()
        .from(userPrivacySettingsTable)
        .where(eq(userPrivacySettingsTable.userId, userId))
        .limit(1);

      const whitelist = await db
        .select({ allowedContactId: presenceWhitelistTable.allowedContactId })
        .from(presenceWhitelistTable)
        .where(eq(presenceWhitelistTable.userId, userId));

      socket.emit("show_presence_dialog", {
        presenceVisibility: privSettings?.presenceVisibility ?? "all",
        readReceiptsEnabled: privSettings?.readReceiptsEnabled ?? true,
        whitelistedContactIds: whitelist.map(w => w.allowedContactId),
      });
    }

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

    socket.on("recording_start", async (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const { sessionId } = data as { sessionId?: unknown };
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;

      const hasAccess = await canAccessSession(sessionId, userId);
      if (!hasAccess) return;

      const key = `${userId}:${sessionId}`;

      if (recordingTimers.has(key)) {
        clearTimeout(recordingTimers.get(key)!);
      }

      socket.to(`session:${sessionId}`).emit("recording_start", {
        userId,
        sessionId,
      });

      recordingTimers.set(
        key,
        setTimeout(() => {
          socket.to(`session:${sessionId}`).emit("recording_stop", {
            userId,
            sessionId,
          });
          recordingTimers.delete(key);
        }, 60000)
      );
    });

    socket.on("recording_stop", async (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const { sessionId } = data as { sessionId?: unknown };
      if (typeof sessionId !== "number" || !Number.isFinite(sessionId)) return;

      const hasAccess = await canAccessSession(sessionId, userId);
      if (!hasAccess) return;

      const key = `${userId}:${sessionId}`;

      if (recordingTimers.has(key)) {
        clearTimeout(recordingTimers.get(key)!);
        recordingTimers.delete(key);
      }

      socket.to(`session:${sessionId}`).emit("recording_stop", {
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

      const [privSettings] = await db
        .select({ readReceiptsEnabled: userPrivacySettingsTable.readReceiptsEnabled })
        .from(userPrivacySettingsTable)
        .where(eq(userPrivacySettingsTable.userId, userId))
        .limit(1);

      const receiptsEnabled = privSettings?.readReceiptsEnabled ?? true;

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

        if (receiptsEnabled) {
          const participants = await db
            .select({ userId: sessionParticipantsTable.userId })
            .from(sessionParticipantsTable)
            .where(and(
              eq(sessionParticipantsTable.sessionId, sessionId),
              eq(sessionParticipantsTable.status, "joined"),
            ));

          const participantIds = participants.map(p => p.userId);

          const allParticipantPrivacy = participantIds.length > 0
            ? await db
              .select({ userId: userPrivacySettingsTable.userId, readReceiptsEnabled: userPrivacySettingsTable.readReceiptsEnabled })
              .from(userPrivacySettingsTable)
              .where(inArray(userPrivacySettingsTable.userId, participantIds))
            : [];

          const privacyMap = new Map(allParticipantPrivacy.map(p => [p.userId, p.readReceiptsEnabled]));
          const eligibleParticipantIds = participantIds.filter(pid => privacyMap.get(pid) !== false);

          if (eligibleParticipantIds.length > 0) {
            const cursors = await db
              .select({ userId: sessionReadCursorsTable.userId, lastReadMessageId: sessionReadCursorsTable.lastReadMessageId })
              .from(sessionReadCursorsTable)
              .where(and(
                eq(sessionReadCursorsTable.sessionId, sessionId),
                inArray(sessionReadCursorsTable.userId, eligibleParticipantIds),
              ));

            const cursorMap = new Map(cursors.map(c => [c.userId, c.lastReadMessageId]));
            const allHaveCursor = eligibleParticipantIds.every(pid => cursorMap.has(pid));
            const minCursor = allHaveCursor
              ? Math.min(...eligibleParticipantIds.map(pid => cursorMap.get(pid)!))
              : 0;

            if (minCursor > 0) {
              const readUpdated = await db.update(messagesTable)
                .set({ status: "read" })
                .where(and(
                  eq(messagesTable.sessionId, sessionId),
                  lte(messagesTable.id, minCursor),
                  ne(messagesTable.status, "read"),
                ))
                .returning({ id: messagesTable.id });

              if (readUpdated.length > 0) {
                emitToSession(sessionId, "message_status_update", {
                  sessionId,
                  messageIds: readUpdated.map(m => m.id),
                  status: "read",
                });
              }
            }
          }
        }
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

      for (const [key, timer] of recordingTimers.entries()) {
        if (key.startsWith(`${userId}:`)) {
          clearTimeout(timer);
          recordingTimers.delete(key);
          const sid = parseInt(key.split(":")[1], 10);
          socket.to(`session:${sid}`).emit("recording_stop", {
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

// Called when a user changes their privacy settings mid-session so contacts update immediately
export async function rebroadcastPresence(userId: number): Promise<void> {
  if (!isUserOnline(userId)) return;
  await broadcastPresence(userId, "online");
}

// Called on connect: sends this user the current online/offline status of every contact
// already connected, applying the reciprocal filter both ways
async function syncPresenceToNewUser(userId: number): Promise<void> {
  if (!io) return;

  const [myPrivRow, myWhitelistRows] = await Promise.all([
    db.select({ presenceVisibility: userPrivacySettingsTable.presenceVisibility })
      .from(userPrivacySettingsTable)
      .where(eq(userPrivacySettingsTable.userId, userId))
      .limit(1),
    db.select({ allowedContactId: presenceWhitelistTable.allowedContactId })
      .from(presenceWhitelistTable)
      .where(eq(presenceWhitelistTable.userId, userId)),
  ]);

  const myVisibility = myPrivRow[0]?.presenceVisibility ?? "all";
  const myWhitelistedIds = new Set(myWhitelistRows.map(w => w.allowedContactId));

  // Collect all other users that share at least one session with me
  const [participantRows, creatorRows] = await Promise.all([
    db.select({ sessionId: sessionParticipantsTable.sessionId })
      .from(sessionParticipantsTable)
      .where(and(eq(sessionParticipantsTable.userId, userId), eq(sessionParticipantsTable.status, "joined"))),
    db.select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.creatorId, userId)),
  ]);

  const mySessionIds = new Set([
    ...participantRows.map(r => r.sessionId),
    ...creatorRows.map(r => r.id),
  ]);

  if (mySessionIds.size === 0) return;

  const sessionIdArr = Array.from(mySessionIds);
  const [sessionParticipantsAll, sessionCreators] = await Promise.all([
    db.select({ userId: sessionParticipantsTable.userId })
      .from(sessionParticipantsTable)
      .where(and(
        inArray(sessionParticipantsTable.sessionId, sessionIdArr),
        eq(sessionParticipantsTable.status, "joined"),
        ne(sessionParticipantsTable.userId, userId),
      )),
    db.select({ creatorId: sessionsTable.creatorId })
      .from(sessionsTable)
      .where(inArray(sessionsTable.id, sessionIdArr)),
  ]);

  const contactUserIds = new Set([
    ...sessionParticipantsAll.map(p => p.userId),
    ...sessionCreators.map(s => s.creatorId).filter(id => id !== userId),
  ]);

  const contactUserIdsArr = Array.from(contactUserIds);
  if (contactUserIdsArr.length === 0) return;

  // Fetch all contacts' privacy settings, whitelists (for me specifically), and DND
  const [contactPrivSettings, contactWhitelistsForMe, contactDndSettings] = await Promise.all([
    db.select({ userId: userPrivacySettingsTable.userId, presenceVisibility: userPrivacySettingsTable.presenceVisibility })
      .from(userPrivacySettingsTable)
      .where(inArray(userPrivacySettingsTable.userId, contactUserIdsArr)),
    db.select({ userId: presenceWhitelistTable.userId })
      .from(presenceWhitelistTable)
      .where(and(
        inArray(presenceWhitelistTable.userId, contactUserIdsArr),
        eq(presenceWhitelistTable.allowedContactId, userId),
      )),
    db.select({ userId: userDndSettingsTable.userId, isDndActive: userDndSettingsTable.isDndActive })
      .from(userDndSettingsTable)
      .where(inArray(userDndSettingsTable.userId, contactUserIdsArr)),
  ]);

  const contactPrivMap = new Map(contactPrivSettings.map(p => [p.userId, p.presenceVisibility]));
  const contactDndMap = new Map(contactDndSettings.map(d => [d.userId, d.isDndActive]));
  // Which contacts have ME in their whitelist
  const contactsWhoWhitelistedMe = new Set(contactWhitelistsForMe.map(w => w.userId));

  const [contactLastSeenRows] = await Promise.all([
    db.select({ id: usersTable.id, lastSeenAt: usersTable.lastSeenAt })
      .from(usersTable)
      .where(inArray(usersTable.id, contactUserIdsArr)),
  ]);
  const contactLastSeenMap = new Map(contactLastSeenRows.map(u => [u.id, u.lastSeenAt]));

  for (const contactId of contactUserIds) {
    const isOnline = isUserOnline(contactId);
    if (!isOnline) continue;

    const contactVisibility = contactPrivMap.get(contactId) ?? "all";

    // Can the contact show themselves to me?
    const contactAllowsMeToSeeThem =
      contactVisibility === "all" ||
      (contactVisibility === "specific" && contactsWhoWhitelistedMe.has(contactId));

    // Am I hiding from the contact? (reciprocal rule — if I hide from them, I don't see them either)
    const iAmHidingFromContact =
      myVisibility === "none" ||
      (myVisibility === "specific" && !myWhitelistedIds.has(contactId));

    const showOnline = contactAllowsMeToSeeThem && !iAmHidingFromContact;

    const lastSeenAt = contactLastSeenMap.get(contactId);

    emitToUser(userId, "presence_update", {
      userId: contactId,
      status: showOnline ? "online" : "offline",
      isDndActive: showOnline ? (contactDndMap.get(contactId) ?? false) : false,
      lastSeenAt: showOnline ? null : (lastSeenAt ? new Date(lastSeenAt).toISOString() : new Date().toISOString()),
    });
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

async function broadcastPresence(userId: number, status: "online" | "offline", prevLastSeenAt?: Date | null): Promise<void> {
  if (!io) return;

  const [[privSettings], [dndSettings]] = await Promise.all([
    db.select().from(userPrivacySettingsTable).where(eq(userPrivacySettingsTable.userId, userId)).limit(1),
    db.select({ isDndActive: userDndSettingsTable.isDndActive }).from(userDndSettingsTable).where(eq(userDndSettingsTable.userId, userId)).limit(1),
  ]);

  const presenceVisibility = privSettings?.presenceVisibility ?? "all";
  const isDndActive = dndSettings?.isDndActive ?? false;

  const participantRows = await db
    .select({ sessionId: sessionParticipantsTable.sessionId })
    .from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.userId, userId), eq(sessionParticipantsTable.status, "joined")));

  const creatorRows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.creatorId, userId));

  const sessionIds = new Set([
    ...participantRows.map((r) => r.sessionId),
    ...creatorRows.map((r) => r.id),
  ]);

  // When going offline, broadcast real offline status to everyone (no filtering needed)
  if (status === "offline") {
    for (const sessionId of sessionIds) {
      io.to(`session:${sessionId}`).emit("presence_update", {
        userId,
        status: "offline",
        isDndActive: false,
        lastSeenAt: new Date().toISOString(),
      });
    }
    return;
  }

  // status === "online" from here
  // If visibility is "none", no one sees this user as online
  if (presenceVisibility === "none") {
    return;
  }

  // Build this user's whitelist (only needed for "specific" visibility)
  let myWhitelistedIds = new Set<number>();
  if (presenceVisibility === "specific") {
    const whitelist = await db
      .select({ allowedContactId: presenceWhitelistTable.allowedContactId })
      .from(presenceWhitelistTable)
      .where(eq(presenceWhitelistTable.userId, userId));
    myWhitelistedIds = new Set(whitelist.map(w => w.allowedContactId));
  }

  const hiddenLastSeenAt = prevLastSeenAt ? prevLastSeenAt.toISOString() : new Date().toISOString();

  for (const sessionId of sessionIds) {
    const sessionParticipants = await db
      .select({ userId: sessionParticipantsTable.userId })
      .from(sessionParticipantsTable)
      .where(and(
        eq(sessionParticipantsTable.sessionId, sessionId),
        eq(sessionParticipantsTable.status, "joined"),
        ne(sessionParticipantsTable.userId, userId),
      ));

    const [sessionInfo] = await db
      .select({ creatorId: sessionsTable.creatorId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);

    const otherUserIds = new Set(sessionParticipants.map(p => p.userId));
    if (sessionInfo?.creatorId && sessionInfo.creatorId !== userId) {
      otherUserIds.add(sessionInfo.creatorId);
    }

    const otherUserIdsArr = Array.from(otherUserIds);
    if (otherUserIdsArr.length === 0) continue;

    // Fetch each observer's privacy settings and whether they have userId in their whitelist
    // This is needed for the reciprocal hiding rule:
    // If observer is hiding from userId, they should also not see userId as online
    const [observerPrivSettings, observerWhitelistsForMe] = await Promise.all([
      db.select({ userId: userPrivacySettingsTable.userId, presenceVisibility: userPrivacySettingsTable.presenceVisibility })
        .from(userPrivacySettingsTable)
        .where(inArray(userPrivacySettingsTable.userId, otherUserIdsArr)),
      db.select({ userId: presenceWhitelistTable.userId })
        .from(presenceWhitelistTable)
        .where(and(
          inArray(presenceWhitelistTable.userId, otherUserIdsArr),
          eq(presenceWhitelistTable.allowedContactId, userId),
        )),
    ]);

    const observerPrivMap = new Map(observerPrivSettings.map(p => [p.userId, p.presenceVisibility]));
    // Set of observer user IDs who have userId in their personal whitelist
    const observersWhoWhitelistedMe = new Set(observerWhitelistsForMe.map(w => w.userId));

    for (const otherUserId of otherUserIds) {
      // Can I show myself to this observer? (based on my own settings)
      const iAllowThemToSeeMe = presenceVisibility === "all" || myWhitelistedIds.has(otherUserId);

      // Is this observer hiding from me? (reciprocal rule)
      // If they are hiding from me, I should not appear online to them,
      // because they won't want to reveal themselves either
      const observerVisibility = observerPrivMap.get(otherUserId) ?? "all";
      const observerIsHidingFromMe =
        observerVisibility === "none" ||
        (observerVisibility === "specific" && !observersWhoWhitelistedMe.has(otherUserId));

      // Show as online only if BOTH: I allow them to see me AND they are not hiding from me
      const showOnline = iAllowThemToSeeMe && !observerIsHidingFromMe;

      emitToUser(otherUserId, "presence_update", {
        userId,
        status: showOnline ? "online" : "offline",
        isDndActive: showOnline ? isDndActive : false,
        lastSeenAt: showOnline ? null : hiddenLastSeenAt,
      });
    }
  }
}
