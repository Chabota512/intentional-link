import { Router, type IRouter } from "express";
import { eq, ilike, and, ne } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  RegisterUserBody,
  LoginUserBody,
  LoginUserResponse,
  GetMeResponse,
  SearchUsersResponseItem,
} from "@workspace/api-zod";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";

const router: IRouter = Router();

router.post("/users/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, name, password } = parsed.data;

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = hashPassword(password);
  const [user] = await db.insert(usersTable).values({ username, name, passwordHash }).returning();

  const token = generateToken(user.id);
  res.status(201).json(LoginUserResponse.parse({
    id: user.id,
    username: user.username,
    name: user.name,
    token,
    createdAt: user.createdAt,
  }));
});

router.post("/users/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = generateToken(user.id);
  res.json(LoginUserResponse.parse({
    id: user.id,
    username: user.username,
    name: user.name,
    token,
    createdAt: user.createdAt,
  }));
});

router.get("/users/me", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(GetMeResponse.parse({ id: user.id, username: user.username, name: user.name, createdAt: user.createdAt }));
});

router.put("/users/me", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { name, username } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || name.trim().length === 0 || name.length > 100)) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }
  if (username !== undefined && (typeof username !== "string" || username.trim().length < 2 || username.length > 50)) {
    res.status(400).json({ error: "Invalid username (2–50 chars)" });
    return;
  }

  const updates: Record<string, string> = {};
  if (name) updates.name = name.trim();
  if (username) {
    const existing = await db.select().from(usersTable)
      .where(and(eq(usersTable.username, username.trim()), ne(usersTable.id, userId)))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    updates.username = username.trim();
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ id: user.id, username: user.username, name: user.name, createdAt: user.createdAt });
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

  const users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    name: usersTable.name,
    createdAt: usersTable.createdAt,
  }).from(usersTable)
    .where(ilike(usersTable.username, `%${q}%`))
    .limit(20);

  res.json(users.map(u => SearchUsersResponseItem.parse(u)));
});

export default router;
