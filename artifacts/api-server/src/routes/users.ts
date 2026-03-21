import { Router, type IRouter } from "express";
import { eq, ilike, and, ne } from "drizzle-orm";

const recoveryAttempts = new Map<string, { count: number; resetAt: number }>();
const RECOVERY_MAX_ATTEMPTS = 5;
const RECOVERY_WINDOW_MS = 15 * 60 * 1000;

function checkRecoveryRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = recoveryAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    recoveryAttempts.set(key, { count: 1, resetAt: now + RECOVERY_WINDOW_MS });
    return true;
  }
  if (entry.count >= RECOVERY_MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}
import { db, usersTable, sessionsTable, sessionParticipantsTable, messagesTable, userPrivacySettingsTable, contactsTable, notificationsTable, uploadsTable, sessionReadCursorsTable, messageReactionsTable } from "@workspace/db";
import { emitToUser, emitToSession } from "../lib/socketio";
import {
  RegisterUserBody,
  LoginUserBody,
  LoginUserResponse,
  GetMeResponse,
  SearchUsersResponseItem,
} from "@workspace/api-zod";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";

const router: IRouter = Router();

function isOnline(lastSeenAt: Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 3 * 60 * 1000;
}

router.post("/users/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration details" });
    return;
  }

  const { username: rawUsername, name, password } = parsed.data;
  const username = rawUsername.trim().toLowerCase();

  const securityQuestion = req.body?.securityQuestion as string | undefined;
  const securityAnswer = req.body?.securityAnswer as string | undefined;

  if (!securityQuestion || !securityAnswer || securityQuestion.trim().length === 0 || securityAnswer.trim().length < 2) {
    res.status(400).json({ error: "Security question and answer are required" });
    return;
  }

  let existing: (typeof usersTable.$inferSelect)[];
  try {
    existing = await db.select().from(usersTable).where(ilike(usersTable.username, username)).limit(1);
  } catch {
    res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
    return;
  }
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const securityAnswerHash = await hashPassword(securityAnswer.trim().toLowerCase());

  let user;
  try {
    [user] = await db.insert(usersTable).values({ username, name: name.trim(), passwordHash, securityQuestion: securityQuestion.trim(), securityAnswerHash }).returning();
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
    return;
  }

  await db.insert(userPrivacySettingsTable)
    .values({ userId: user.id, presenceVisibility: "all", readReceiptsEnabled: true, updatedAt: new Date() })
    .onConflictDoNothing();

  const token = generateToken(user.id);
  res.status(201).json(LoginUserResponse.parse({
    id: user.id,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    token,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
  }));
});

router.post("/users/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { username: rawUsername, password } = parsed.data;
  const username = rawUsername.trim().toLowerCase();

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    [user] = await db.select().from(usersTable)
      .where(or(ilike(usersTable.username, username), ilike(usersTable.name, username)))
      .limit(1);
  } catch {
    res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
    return;
  }

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const now = new Date();
  try {
    await db.update(usersTable).set({ lastSeenAt: now }).where(eq(usersTable.id, user.id));
  } catch {
    // non-critical — log but don't fail login
    console.error("Failed to update lastSeenAt");
  }

  const token = generateToken(user.id);
  res.json(LoginUserResponse.parse({
    id: user.id,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    token,
    createdAt: user.createdAt,
    lastSeenAt: now,
  }));
});

router.post("/users/security-question", async (req, res): Promise<void> => {
  const { username: rawUsername } = req.body ?? {};
  if (!rawUsername || typeof rawUsername !== "string" || rawUsername.trim().length === 0) {
    res.status(400).json({ error: "Username is required" });
    return;
  }

  const username = rawUsername.trim().toLowerCase();

  if (!checkRecoveryRateLimit(`sq:${username}`)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }

  try {
    const [user] = await db.select({
      id: usersTable.id,
      securityQuestion: usersTable.securityQuestion,
    }).from(usersTable)
      .where(ilike(usersTable.username, username))
      .limit(1);

    if (!user || !user.securityQuestion) {
      res.status(404).json({ error: "Unable to process request" });
      return;
    }

    res.json({ securityQuestion: user.securityQuestion });
  } catch (err) {
    console.error("[POST /users/security-question] Error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/users/reset-password", async (req, res): Promise<void> => {
  const { username: rawUsername, securityAnswer, newPassword } = req.body ?? {};

  if (!rawUsername || typeof rawUsername !== "string") {
    res.status(400).json({ error: "Username is required" });
    return;
  }
  if (!securityAnswer || typeof securityAnswer !== "string" || securityAnswer.trim().length < 2) {
    res.status(400).json({ error: "Security answer is required" });
    return;
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const username = rawUsername.trim().toLowerCase();

  if (!checkRecoveryRateLimit(`rp:${username}`)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }

  try {
    const [user] = await db.select({
      id: usersTable.id,
      securityAnswerHash: usersTable.securityAnswerHash,
    }).from(usersTable)
      .where(ilike(usersTable.username, username))
      .limit(1);

    if (!user || !user.securityAnswerHash) {
      res.status(400).json({ error: "Unable to reset password" });
      return;
    }

    const answerMatch = await verifyPassword(securityAnswer.trim().toLowerCase(), user.securityAnswerHash);
    if (!answerMatch) {
      res.status(400).json({ error: "Unable to reset password" });
      return;
    }

    const newHash = await hashPassword(newPassword);
    await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));

    res.json({ ok: true });
  } catch (err) {
    console.error("[POST /users/reset-password] Error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.get("/users/me", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    res.json(GetMeResponse.parse({
      id: user.id,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    }));
  } catch (err) {
    console.error("[GET /users/me] Error:", err);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

router.put("/users/me", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { name, username, avatarUrl, pushToken } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0 || name.length > 100)) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }
  if (username !== undefined && (typeof username !== "string" || username.trim().length < 2 || username.length > 50)) {
    res.status(400).json({ error: "Invalid username (2–50 chars)" });
    return;
  }
  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== "string") {
    res.status(400).json({ error: "Invalid avatarUrl" });
    return;
  }

  try {
    const updates: Record<string, string | null> = {};
    if (name) updates.name = name.trim();
    if (username) {
      const normalizedUsername = username.trim().toLowerCase();
      const existing = await db.select().from(usersTable)
        .where(and(ilike(usersTable.username, normalizedUsername), ne(usersTable.id, userId)))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "Username already taken" });
        return;
      }
      updates.username = normalizedUsername;
    }
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (pushToken !== undefined && typeof pushToken === "string") updates.pushToken = pushToken;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: user.id,
      username: user.username,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    });
  } catch (err) {
    console.error("[PUT /users/me] Error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

router.post("/users/heartbeat", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const now = new Date();
    await db.update(usersTable).set({ lastSeenAt: now }).where(eq(usersTable.id, userId));
    res.json({ ok: true, lastSeenAt: now });
  } catch (err) {
    console.error("[POST /users/heartbeat] Error:", err);
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

router.get("/users/search", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const q = req.query.q as string;
  if (!q) {
    res.json([]);
    return;
  }

  let users;
  try {
    users = await db.select({
      id: usersTable.id,
      username: usersTable.username,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      createdAt: usersTable.createdAt,
      lastSeenAt: usersTable.lastSeenAt,
    }).from(usersTable)
      .where(and(or(ilike(usersTable.username, `%${q}%`), ilike(usersTable.name, `%${q}%`)), ne(usersTable.id, userId)))
      .limit(20);
  } catch {
    res.status(503).json({ error: "Search unavailable. Please try again." });
    return;
  }

  res.json(users.map(u => SearchUsersResponseItem.parse(u)));
});

router.delete("/users/me/data", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const createdSessions = await db.select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.creatorId, userId));

    const participantSessions = await db
      .select({ sessionId: sessionParticipantsTable.sessionId })
      .from(sessionParticipantsTable)
      .where(eq(sessionParticipantsTable.userId, userId));

    for (const session of createdSessions) {
      const otherParticipants = await db
        .select({ userId: sessionParticipantsTable.userId })
        .from(sessionParticipantsTable)
        .where(and(
          eq(sessionParticipantsTable.sessionId, session.id),
          eq(sessionParticipantsTable.status, "joined"),
          ne(sessionParticipantsTable.userId, userId),
        ));

      if (otherParticipants.length > 0) {
        const newOwnerId = otherParticipants[0].userId;
        await db.update(sessionsTable)
          .set({ creatorId: newOwnerId })
          .where(eq(sessionsTable.id, session.id));
        emitToSession(session.id, "participant_left", { sessionId: session.id, userId });
      } else {
        await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id));
      }
    }

    await db.delete(sessionParticipantsTable).where(eq(sessionParticipantsTable.userId, userId));
    await db.delete(sessionReadCursorsTable).where(eq(sessionReadCursorsTable.userId, userId));
    await db.delete(messageReactionsTable).where(eq(messageReactionsTable.userId, userId));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
    await db.delete(contactsTable).where(eq(contactsTable.userId, userId));
    await db.delete(contactsTable).where(eq(contactsTable.contactUserId, userId));

    for (const { sessionId } of participantSessions) {
      if (!createdSessions.some(s => s.id === sessionId)) {
        emitToSession(sessionId, "participant_left", { sessionId, userId });
      }
    }

    await db.update(usersTable)
      .set({ avatarUrl: null, pushToken: null })
      .where(eq(usersTable.id, userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /users/me/data] Error:", err);
    res.status(500).json({ error: "Failed to clear user data" });
  }
});

router.delete("/users/me", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const createdSessions = await db.select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.creatorId, userId));

    for (const session of createdSessions) {
      await db.delete(sessionsTable).where(eq(sessionsTable.id, session.id));
    }

    await db.delete(sessionParticipantsTable).where(eq(sessionParticipantsTable.userId, userId));
    await db.delete(sessionReadCursorsTable).where(eq(sessionReadCursorsTable.userId, userId));
    await db.delete(messageReactionsTable).where(eq(messageReactionsTable.userId, userId));
    await db.delete(messagesTable).where(eq(messagesTable.senderId, userId));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
    await db.delete(contactsTable).where(eq(contactsTable.userId, userId));
    await db.delete(contactsTable).where(eq(contactsTable.contactUserId, userId));
    await db.delete(uploadsTable).where(eq(uploadsTable.uploadedBy, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /users/me] Error:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

export { isOnline };
export default router;
