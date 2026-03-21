import { Router, type IRouter } from "express";
import { eq, and, lt, gt, ne, desc, inArray, ilike } from "drizzle-orm";
import { db, messagesTable, usersTable, sessionsTable, sessionParticipantsTable, messageReactionsTable } from "@workspace/db";
import { SendMessageBody, GetMessagesResponseItem } from "@workspace/api-zod";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitToSession, isUserOnline } from "../lib/socketio";

const router: IRouter = Router();

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

async function formatMessages(msgs: (typeof messagesTable.$inferSelect)[]) {
  if (msgs.length === 0) return [];

  const senderIds = [...new Set(msgs.map(m => m.senderId))];
  const msgIds = msgs.map(m => m.id);

  const [senders, allReactions] = await Promise.all([
    db.select({
      id: usersTable.id,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      createdAt: usersTable.createdAt,
      lastSeenAt: usersTable.lastSeenAt,
    }).from(usersTable).where(inArray(usersTable.id, senderIds)),
    db.select({
      messageId: messageReactionsTable.messageId,
      userId: messageReactionsTable.userId,
      emoji: messageReactionsTable.emoji,
    }).from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, msgIds)),
  ]);

  const senderMap = new Map(senders.map(s => [s.id, s]));

  const reactionsMap = new Map<number, Map<string, number[]>>();
  for (const r of allReactions) {
    if (!reactionsMap.has(r.messageId)) reactionsMap.set(r.messageId, new Map());
    const emojiMap = reactionsMap.get(r.messageId)!;
    if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, []);
    emojiMap.get(r.emoji)!.push(r.userId);
  }

  const replyToIds = msgs.map(m => m.replyToId).filter((id): id is number => id != null);
  let replyMap = new Map<number, { id: number; content: string; senderId: number; senderName: string; type: string }>();
  if (replyToIds.length > 0) {
    const replyMsgs = await db.select({
      id: messagesTable.id,
      content: messagesTable.content,
      senderId: messagesTable.senderId,
      type: messagesTable.type,
    }).from(messagesTable).where(inArray(messagesTable.id, replyToIds));

    for (const rm of replyMsgs) {
      const sender = senderMap.get(rm.senderId);
      replyMap.set(rm.id, {
        id: rm.id,
        content: rm.content,
        senderId: rm.senderId,
        senderName: sender?.name ?? "Unknown",
        type: rm.type,
      });
    }
  }

  return msgs.map(m => {
    const emojiMap = reactionsMap.get(m.id);
    const reactions = emojiMap
      ? Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }))
      : [];

    const base: any = {
      ...m,
      reactions,
      sender: senderMap.get(m.senderId) ?? { id: m.senderId, name: "Unknown", username: "unknown", createdAt: new Date(), lastSeenAt: null },
    };

    if (m.replyToId && replyMap.has(m.replyToId)) {
      base.replyTo = replyMap.get(m.replyToId);
    }

    return base;
  });
}

router.get("/sessions/:sessionId/messages", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  if (!(await canAccessSession(sessionId, userId))) {
    res.status(403).json({ error: "You do not have access to this session" });
    return;
  }

  const limit = parseInt(req.query.limit as string || "50", 10);
  const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;

  let msgs;
  if (before) {
    msgs = await db.select().from(messagesTable)
      .where(and(eq(messagesTable.sessionId, sessionId), lt(messagesTable.id, before)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit);
  } else {
    msgs = await db.select().from(messagesTable)
      .where(eq(messagesTable.sessionId, sessionId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit);
  }
  msgs.reverse();

  const readUpdated = await db.update(messagesTable)
    .set({ status: "read" })
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        ne(messagesTable.senderId, userId),
        ne(messagesTable.status, "read")
      )
    )
    .returning({ id: messagesTable.id, senderId: messagesTable.senderId });

  if (readUpdated.length > 0) {
    emitToSession(sessionId, "message_status_update", {
      sessionId,
      messageIds: readUpdated.map(m => m.id),
      status: "read",
      readBy: userId,
    });
  }

  const formatted = await formatMessages(msgs);
  res.json(formatted);
});

router.post("/sessions/:sessionId/messages", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  if (!(await canAccessSession(sessionId, userId))) {
    res.status(403).json({ error: "You do not have access to this session" });
    return;
  }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, type, attachmentUrl, attachmentName, attachmentSize, replyToId } = parsed.data;

  if (type === "text" && !content?.trim()) {
    res.status(400).json({ error: "Message content cannot be empty" });
    return;
  }

  if ((type === "image" || type === "file" || type === "voice") && !attachmentUrl) {
    res.status(400).json({ error: "attachmentUrl is required for media messages" });
    return;
  }

  if (replyToId) {
    const [replyMsg] = await db.select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(eq(messagesTable.id, replyToId), eq(messagesTable.sessionId, sessionId)))
      .limit(1);
    if (!replyMsg) {
      res.status(400).json({ error: "Reply target message not found in this session" });
      return;
    }
  }

  const [msg] = await db.insert(messagesTable).values({
    sessionId,
    senderId: userId,
    content: content || "",
    type: type || "text",
    attachmentUrl: attachmentUrl || null,
    attachmentName: attachmentName || null,
    attachmentSize: attachmentSize || null,
    replyToId: replyToId || null,
    status: "sent",
  }).returning();

  const [formatted] = await formatMessages([msg]);
  res.status(201).json(formatted);

  emitToSession(sessionId, "new_message", formatted);

  (async () => {
    try {
      const participants = await db
        .select({ userId: sessionParticipantsTable.userId })
        .from(sessionParticipantsTable)
        .where(and(
          eq(sessionParticipantsTable.sessionId, sessionId),
          ne(sessionParticipantsTable.userId, userId),
          eq(sessionParticipantsTable.status, "joined")
        ));

      const [session] = await db.select({ creatorId: sessionsTable.creatorId })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1);

      const otherUserIds = participants.map(p => p.userId);
      if (session && session.creatorId !== userId && !otherUserIds.includes(session.creatorId)) {
        otherUserIds.push(session.creatorId);
      }

      const onlineRecipients = otherUserIds.filter(id => isUserOnline(id));
      if (onlineRecipients.length > 0) {
        const deliveredIds = [msg.id];
        await db.update(messagesTable)
          .set({ status: "delivered" })
          .where(and(eq(messagesTable.id, msg.id), eq(messagesTable.status, "sent")));

        emitToSession(sessionId, "message_status_update", {
          sessionId,
          messageIds: deliveredIds,
          status: "delivered",
        });
      }

      const offlineUserIds = otherUserIds.filter(id => !isUserOnline(id));
      if (offlineUserIds.length === 0) return;

      const others = await db.select({ pushToken: usersTable.pushToken })
        .from(usersTable)
        .where(inArray(usersTable.id, offlineUserIds));

      const tokens = others.map(u => u.pushToken).filter(Boolean) as string[];
      if (tokens.length === 0) return;

      const [sender] = await db.select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      const [sessionRow] = await db.select({ name: sessionsTable.title })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1);

      const senderName = sender?.name || "Someone";
      const sessionName = sessionRow?.name || "a session";
      const notifBody = type === "voice"
        ? `${senderName} sent a voice note`
        : type === "image"
          ? `${senderName} sent an image`
          : type === "file"
            ? `${senderName} sent a file`
            : `${senderName}: ${(content || "").slice(0, 80)}`;

      await sendPushNotifications(tokens, sessionName, notifBody, { sessionId });
    } catch {}
  })();
});

router.get("/sessions/:sessionId/messages/poll", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  if (!(await canAccessSession(sessionId, userId))) {
    res.status(403).json({ error: "You do not have access to this session" });
    return;
  }

  const since = parseInt(req.query.since as string || "0", 10);

  const msgs = await db.select().from(messagesTable)
    .where(and(eq(messagesTable.sessionId, sessionId), gt(messagesTable.id, since)))
    .orderBy(messagesTable.createdAt);

  await db.update(messagesTable)
    .set({ status: "read" })
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        ne(messagesTable.senderId, userId),
        ne(messagesTable.status, "read")
      )
    );

  const formatted = await formatMessages(msgs);
  res.json(formatted);
});

router.post("/sessions/:sessionId/messages/:messageId/play", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);
  const messageId = parseInt(req.params.messageId, 10);

  if (!(await canAccessSession(sessionId, userId))) {
    res.status(403).json({ error: "You do not have access to this session" });
    return;
  }

  await db.update(messagesTable)
    .set({ status: "read" })
    .where(
      and(
        eq(messagesTable.id, messageId),
        ne(messagesTable.senderId, userId)
      )
    );

  res.json({ ok: true });
});

router.post("/sessions/:sessionId/messages/:messageId/react", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);
  const messageId = parseInt(req.params.messageId, 10);
  const { emoji } = req.body;

  if (!emoji || typeof emoji !== "string") {
    res.status(400).json({ error: "emoji is required" });
    return;
  }

  if (!(await canAccessSession(sessionId, userId))) {
    res.status(403).json({ error: "You do not have access to this session" });
    return;
  }

  const [existing] = await db.select({ id: messageReactionsTable.id })
    .from(messageReactionsTable)
    .where(and(
      eq(messageReactionsTable.messageId, messageId),
      eq(messageReactionsTable.userId, userId),
      eq(messageReactionsTable.emoji, emoji)
    ))
    .limit(1);

  if (existing) {
    await db.delete(messageReactionsTable).where(eq(messageReactionsTable.id, existing.id));
    res.json({ action: "removed" });

    emitToSession(sessionId, "reaction_removed", {
      messageId,
      userId,
      emoji,
      sessionId,
    });
  } else {
    await db.insert(messageReactionsTable).values({ messageId, userId, emoji });
    res.json({ action: "added" });

    emitToSession(sessionId, "reaction_added", {
      messageId,
      userId,
      emoji,
      sessionId,
    });
  }
});

router.get("/messages/search", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const q = req.query.q as string;
  if (!q || q.trim().length === 0) {
    res.json({ results: [] });
    return;
  }

  const sessionIdFilter = req.query.sessionId ? parseInt(req.query.sessionId as string, 10) : undefined;

  const participantRows = await db
    .select({ sessionId: sessionParticipantsTable.sessionId })
    .from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.userId, userId), eq(sessionParticipantsTable.status, "joined")));

  const creatorRows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.creatorId, userId));

  const allSessionIds = [...new Set([
    ...participantRows.map(r => r.sessionId),
    ...creatorRows.map(r => r.id),
  ])];

  if (allSessionIds.length === 0) {
    res.json({ results: [] });
    return;
  }

  const targetSessionIds = sessionIdFilter
    ? allSessionIds.filter(id => id === sessionIdFilter)
    : allSessionIds;

  if (targetSessionIds.length === 0) {
    res.json({ results: [] });
    return;
  }

  const searchTerm = `%${q.trim()}%`;

  const msgs = await db.select({
    id: messagesTable.id,
    sessionId: messagesTable.sessionId,
    senderId: messagesTable.senderId,
    content: messagesTable.content,
    type: messagesTable.type,
    createdAt: messagesTable.createdAt,
  })
    .from(messagesTable)
    .where(
      and(
        inArray(messagesTable.sessionId, targetSessionIds),
        ilike(messagesTable.content, searchTerm)
      )
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(50);

  const sessionIds = [...new Set(msgs.map(m => m.sessionId))];
  const senderIds = [...new Set(msgs.map(m => m.senderId))];

  const [sessions, senders] = await Promise.all([
    sessionIds.length > 0
      ? db.select({ id: sessionsTable.id, title: sessionsTable.title, status: sessionsTable.status })
          .from(sessionsTable)
          .where(inArray(sessionsTable.id, sessionIds))
      : [],
    senderIds.length > 0
      ? db.select({ id: usersTable.id, name: usersTable.name, username: usersTable.username, avatarUrl: usersTable.avatarUrl })
          .from(usersTable)
          .where(inArray(usersTable.id, senderIds))
      : [],
  ]);

  const sessionMap = new Map(sessions.map(s => [s.id, s]));
  const senderMap = new Map(senders.map(s => [s.id, s]));

  const searchLower = q.trim().toLowerCase();
  const results = msgs.map(m => {
    let snippet = m.content;
    const idx = m.content.toLowerCase().indexOf(searchLower);
    if (idx !== -1) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(m.content.length, idx + searchLower.length + 40);
      snippet = (start > 0 ? "..." : "") + m.content.slice(start, end) + (end < m.content.length ? "..." : "");
    } else if (m.content.length > 120) {
      snippet = m.content.slice(0, 120) + "...";
    }

    return {
      id: m.id,
      content: m.content,
      snippet,
      type: m.type,
      createdAt: m.createdAt,
      sessionId: m.sessionId,
      session: sessionMap.get(m.sessionId) ?? { id: m.sessionId, title: "Unknown", status: "active" },
      sender: senderMap.get(m.senderId) ?? { id: m.senderId, name: "Unknown", username: "unknown", avatarUrl: null },
    };
  });

  res.json({ results });
});

router.delete("/sessions/:sessionId/messages/:messageId", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionId = parseInt(Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);

  if (!(await canAccessSession(sessionId, userId))) {
    res.status(403).json({ error: "You do not have access to this session" });
    return;
  }

  const [msg] = await db.select({ id: messagesTable.id, senderId: messagesTable.senderId })
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.sessionId, sessionId)))
    .limit(1);

  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  if (msg.senderId !== userId) {
    res.status(403).json({ error: "You can only delete your own messages" });
    return;
  }

  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));

  emitToSession(sessionId, "message_deleted", { sessionId, messageId });

  res.sendStatus(204);
});

export default router;
