import { Router, type IRouter } from "express";
import { eq, and, lt, gt, ne, desc, inArray } from "drizzle-orm";
import { db, messagesTable, usersTable, sessionsTable, sessionParticipantsTable } from "@workspace/db";
import { SendMessageBody, GetMessagesResponseItem } from "@workspace/api-zod";
import { sendPushNotifications } from "../lib/pushNotifications";

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

  const senders = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    username: usersTable.username,
    avatarUrl: usersTable.avatarUrl,
    createdAt: usersTable.createdAt,
    lastSeenAt: usersTable.lastSeenAt,
  }).from(usersTable).where(inArray(usersTable.id, senderIds));

  const senderMap = new Map(senders.map(s => [s.id, s]));

  return msgs.map(m => GetMessagesResponseItem.parse({
    ...m,
    sender: senderMap.get(m.senderId) ?? { id: m.senderId, name: "Unknown", username: "unknown", createdAt: new Date(), lastSeenAt: null },
  }));
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

  const { content, type, attachmentUrl, attachmentName, attachmentSize } = parsed.data;

  if (type === "text" && !content?.trim()) {
    res.status(400).json({ error: "Message content cannot be empty" });
    return;
  }

  if ((type === "image" || type === "file" || type === "voice") && !attachmentUrl) {
    res.status(400).json({ error: "attachmentUrl is required for media messages" });
    return;
  }

  const [msg] = await db.insert(messagesTable).values({
    sessionId,
    senderId: userId,
    content: content || "",
    type: type || "text",
    attachmentUrl: attachmentUrl || null,
    attachmentName: attachmentName || null,
    attachmentSize: attachmentSize || null,
    status: "sent",
  }).returning();

  const [formatted] = await formatMessages([msg]);
  res.status(201).json(formatted);

  (async () => {
    try {
      const [sender] = await db.select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      const [session] = await db.select({ name: sessionsTable.name, creatorId: sessionsTable.creatorId })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1);

      const participants = await db
        .select({ userId: sessionParticipantsTable.userId })
        .from(sessionParticipantsTable)
        .where(and(
          eq(sessionParticipantsTable.sessionId, sessionId),
          ne(sessionParticipantsTable.userId, userId),
          eq(sessionParticipantsTable.status, "joined")
        ));

      const otherUserIds = participants.map(p => p.userId);
      if (session && session.creatorId !== userId) otherUserIds.push(session.creatorId);

      if (otherUserIds.length === 0) return;

      const others = await db.select({ pushToken: usersTable.pushToken })
        .from(usersTable)
        .where(inArray(usersTable.id, otherUserIds));

      const tokens = others.map(u => u.pushToken).filter(Boolean) as string[];
      if (tokens.length === 0) return;

      const senderName = sender?.displayName || "Someone";
      const sessionName = session?.name || "a session";
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

export default router;
