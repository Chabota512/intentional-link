import { Router, type IRouter } from "express";
import { eq, and, inArray, ne } from "drizzle-orm";
import { db, sessionsTable, sessionParticipantsTable, usersTable } from "@workspace/db";
import {
  CreateSessionBody,
  UpdateSessionBody,
  InviteToSessionBody,
  GetSessionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getSessionWithParticipants(sessionId: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) return null;

  const participants = await db
    .select({
      id: sessionParticipantsTable.id,
      userId: sessionParticipantsTable.userId,
      sessionId: sessionParticipantsTable.sessionId,
      status: sessionParticipantsTable.status,
      userName: usersTable.name,
      userUsername: usersTable.username,
      userCreatedAt: usersTable.createdAt,
      userLastSeenAt: usersTable.lastSeenAt,
    })
    .from(sessionParticipantsTable)
    .innerJoin(usersTable, eq(sessionParticipantsTable.userId, usersTable.id))
    .where(eq(sessionParticipantsTable.sessionId, sessionId));

  const [creator] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    username: usersTable.username,
    lastSeenAt: usersTable.lastSeenAt,
  }).from(usersTable).where(eq(usersTable.id, session.creatorId)).limit(1);

  const parsed = GetSessionResponse.parse({
    ...session,
    participants: participants.map(p => ({
      id: p.id,
      userId: p.userId,
      sessionId: p.sessionId,
      status: p.status,
      user: { id: p.userId, name: p.userName, username: p.userUsername, createdAt: p.userCreatedAt, lastSeenAt: p.userLastSeenAt },
    })),
  });

  return { ...parsed, creator: creator ?? null };
}

async function getSessionMembership(sessionId: number, userId: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) return null;

  const isCreator = session.creatorId === userId;

  const [participant] = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
    .limit(1);

  return { session, isCreator, participant: participant ?? null };
}

router.get("/sessions", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const statusFilter = req.query.status as string | undefined;
  if (statusFilter !== undefined && statusFilter !== "active" && statusFilter !== "completed") {
    res.status(400).json({ error: "Invalid status filter. Use 'active' or 'completed'" });
    return;
  }

  const participantRows = await db
    .select({ sessionId: sessionParticipantsTable.sessionId })
    .from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.userId, userId), ne(sessionParticipantsTable.status, "declined")));

  const participantSessionIds = participantRows.map(r => r.sessionId);

  let creatorSessions = await db.select().from(sessionsTable).where(
    statusFilter === "active" || statusFilter === "completed"
      ? and(eq(sessionsTable.creatorId, userId), eq(sessionsTable.status, statusFilter))
      : eq(sessionsTable.creatorId, userId)
  );

  let participantSessions = participantSessionIds.length > 0
    ? await db.select().from(sessionsTable).where(
        statusFilter === "active" || statusFilter === "completed"
          ? and(inArray(sessionsTable.id, participantSessionIds), eq(sessionsTable.status, statusFilter))
          : inArray(sessionsTable.id, participantSessionIds)
      )
    : [];

  const allSessions = [...creatorSessions, ...participantSessions]
    .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const results = await Promise.all(allSessions.map(s => getSessionWithParticipants(s.id)));
  res.json(results.filter(Boolean));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [session] = await db.insert(sessionsTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    creatorId: userId,
    status: "active",
  }).returning();

  const result = await getSessionWithParticipants(session.id);
  res.status(201).json(result);
});

router.get("/sessions/:sessionId", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!membership.isCreator && !membership.participant) {
    res.status(403).json({ error: "You are not a member of this session" });
    return;
  }

  const result = await getSessionWithParticipants(sessionId);
  if (!result) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(result);
});

router.patch("/sessions/:sessionId", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!membership.isCreator) {
    res.status(403).json({ error: "Only the session creator can update this session" });
    return;
  }

  const parsed = UpdateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "completed") updates.endedAt = new Date();
  }

  const [session] = await db.update(sessionsTable)
    .set(updates)
    .where(eq(sessionsTable.id, sessionId))
    .returning();

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = await getSessionWithParticipants(session.id);
  res.json(result);
});

router.post("/sessions/:sessionId/invite", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!membership.isCreator) {
    res.status(403).json({ error: "Only the session creator can invite participants" });
    return;
  }

  const parsed = InviteToSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, parsed.data.userId)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(sessionParticipantsTable).values({
      sessionId,
      userId: parsed.data.userId,
      status: "invited",
    });
  }

  const result = await getSessionWithParticipants(sessionId);
  res.json(result);
});

router.post("/sessions/:sessionId/join", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const [sessionRow] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!sessionRow) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [existing] = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
    .limit(1);

  if (!existing) {
    res.status(403).json({ error: "You have not been invited to this session" });
    return;
  }

  if (existing.status !== "joined") {
    await db.update(sessionParticipantsTable)
      .set({ status: "joined" })
      .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)));
  }

  const result = await getSessionWithParticipants(sessionId);
  res.json(result);
});

router.get("/sessions/:sessionId/preview", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const [session] = await db.select({
    id: sessionsTable.id,
    title: sessionsTable.title,
    status: sessionsTable.status,
    createdAt: sessionsTable.createdAt,
  }).from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const participantCount = await db
    .select({ count: sessionParticipantsTable.id })
    .from(sessionParticipantsTable)
    .where(eq(sessionParticipantsTable.sessionId, sessionId));

  const [creatorRow] = await db.select({ name: usersTable.name, username: usersTable.username })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.creatorId, usersTable.id))
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  res.json({
    id: session.id,
    title: session.title,
    status: session.status,
    createdAt: session.createdAt,
    participantCount: participantCount.length + 1,
    creatorName: creatorRow?.name ?? "Unknown",
  });
});

router.post("/sessions/:sessionId/join-link", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status !== "active") {
    res.status(400).json({ error: "This session has already ended" });
    return;
  }

  if (session.creatorId === userId) {
    const result = await getSessionWithParticipants(sessionId);
    res.json(result);
    return;
  }

  const [existing] = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
    .limit(1);

  if (existing) {
    if (existing.status !== "joined") {
      await db.update(sessionParticipantsTable)
        .set({ status: "joined" })
        .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)));
    }
  } else {
    await db.insert(sessionParticipantsTable).values({ sessionId, userId, status: "joined" });
  }

  const result = await getSessionWithParticipants(sessionId);
  res.json(result);
});

router.post("/sessions/:sessionId/decline", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const [participant] = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
    .limit(1);

  if (!participant) {
    res.status(404).json({ error: "You are not invited to this session" });
    return;
  }

  if (participant.status === "joined") {
    res.status(400).json({ error: "You have already joined this session. Use leave instead." });
    return;
  }

  await db.update(sessionParticipantsTable)
    .set({ status: "declined" })
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)));

  res.sendStatus(204);
});

router.delete("/sessions/:sessionId/leave", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
  const sessionId = parseInt(raw, 10);

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.creatorId === userId) {
    res.status(400).json({ error: "Creator cannot leave — end the session instead" });
    return;
  }

  const [deleted] = await db.delete(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "You are not a participant in this session" });
    return;
  }

  res.sendStatus(204);
});

export default router;
