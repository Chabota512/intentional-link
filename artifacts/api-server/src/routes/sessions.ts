import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
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
    })
    .from(sessionParticipantsTable)
    .innerJoin(usersTable, eq(sessionParticipantsTable.userId, usersTable.id))
    .where(eq(sessionParticipantsTable.sessionId, sessionId));

  return GetSessionResponse.parse({
    ...session,
    participants: participants.map(p => ({
      id: p.id,
      userId: p.userId,
      sessionId: p.sessionId,
      status: p.status,
      user: { id: p.userId, name: p.userName, username: p.userUsername, createdAt: p.userCreatedAt },
    })),
  });
}

router.get("/sessions", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const statusFilter = req.query.status as string | undefined;

  const participantRows = await db
    .select({ sessionId: sessionParticipantsTable.sessionId })
    .from(sessionParticipantsTable)
    .where(eq(sessionParticipantsTable.userId, userId));

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

  const existing = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.update(sessionParticipantsTable)
      .set({ status: "joined" })
      .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)));
  } else {
    await db.insert(sessionParticipantsTable).values({ sessionId, userId, status: "joined" });
  }

  const result = await getSessionWithParticipants(sessionId);
  res.json(result);
});

export default router;
