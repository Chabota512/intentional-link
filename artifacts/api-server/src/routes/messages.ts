import { Router, type IRouter } from "express";
import { eq, and, lt, gt, ne, desc, inArray } from "drizzle-orm";
import { db, messagesTable, usersTable, sessionsTable, sessionParticipantsTable } from "@workspace/db";
import { SendMessageBody, GetMessagesResponseItem } from "@workspace/api-zod";

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
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(inArray(usersTable.id, senderIds));

  const senderMap = new Map(senders.map(s => [s.id, s]));

  return msgs.map(m => GetMessagesResponseItem.parse({
    ...m,
    sender: senderMap.get(m.senderId) ?? { id: m.senderId, name: "Unknown", username: "unknown", createdAt: new Date() },
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
    .set({ status: "delivered" })
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        ne(messagesTable.senderId, userId),
        eq(messagesTable.status, "sent")
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

  const [msg] = await db.insert(messagesTable).values({
    sessionId,
    senderId: userId,
    content: parsed.data.content,
    status: "sent",
  }).returning();

  const [formatted] = await formatMessages([msg]);
  res.status(201).json(formatted);
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
    .set({ status: "delivered" })
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        ne(messagesTable.senderId, userId),
        eq(messagesTable.status, "sent")
      )
    );

  const formatted = await formatMessages(msgs);
  res.json(formatted);
});

export default router;
