import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  contactsTable,
  userPrivacySettingsTable,
  presenceWhitelistTable,
  sessionsTable,
  sessionParticipantsTable,
  messagesTable,
} from "@workspace/db";
import { verifyToken } from "../lib/auth";

const router: IRouter = Router();

function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = verifyToken(token);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}

async function getOrCreatePrivacySettings(userId: number) {
  const [existing] = await db
    .select()
    .from(userPrivacySettingsTable)
    .where(eq(userPrivacySettingsTable.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(userPrivacySettingsTable)
    .values({ userId, presenceVisibility: "all", readReceiptsEnabled: true, updatedAt: new Date() })
    .returning();

  return created;
}

router.get("/users/privacy", authMiddleware, async (req: any, res): Promise<void> => {
  const userId = req.userId as number;

  const settings = await getOrCreatePrivacySettings(userId);

  const whitelist = await db
    .select({ allowedContactId: presenceWhitelistTable.allowedContactId })
    .from(presenceWhitelistTable)
    .where(eq(presenceWhitelistTable.userId, userId));

  res.json({
    presenceVisibility: settings.presenceVisibility,
    readReceiptsEnabled: settings.readReceiptsEnabled,
    whitelistedContactIds: whitelist.map(w => w.allowedContactId),
  });
});

router.put("/users/privacy", authMiddleware, async (req: any, res): Promise<void> => {
  const userId = req.userId as number;
  const { presenceVisibility, readReceiptsEnabled, whitelistedContactIds } = req.body;

  const validVisibility = ["all", "specific", "none"];
  if (presenceVisibility !== undefined && !validVisibility.includes(presenceVisibility)) {
    res.status(400).json({ error: "Invalid presenceVisibility value" });
    return;
  }

  await db
    .insert(userPrivacySettingsTable)
    .values({
      userId,
      presenceVisibility: presenceVisibility ?? "all",
      readReceiptsEnabled: readReceiptsEnabled ?? true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userPrivacySettingsTable.userId,
      set: {
        ...(presenceVisibility !== undefined ? { presenceVisibility } : {}),
        ...(readReceiptsEnabled !== undefined ? { readReceiptsEnabled } : {}),
        updatedAt: new Date(),
      },
    });

  if (presenceVisibility === "specific" && Array.isArray(whitelistedContactIds)) {
    await db
      .delete(presenceWhitelistTable)
      .where(eq(presenceWhitelistTable.userId, userId));

    if (whitelistedContactIds.length > 0) {
      await db.insert(presenceWhitelistTable).values(
        whitelistedContactIds.map((cid: number) => ({ userId, allowedContactId: cid }))
      );
    }
  } else if (presenceVisibility === "all" || presenceVisibility === "none") {
    await db
      .delete(presenceWhitelistTable)
      .where(eq(presenceWhitelistTable.userId, userId));
  }

  res.json({ ok: true });
});

router.get("/users/privacy/contacts", authMiddleware, async (req: any, res): Promise<void> => {
  const userId = req.userId as number;

  const acceptedContacts = await db
    .select({
      contactUserId: contactsTable.contactUserId,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(contactsTable)
    .innerJoin(usersTable, eq(contactsTable.contactUserId, usersTable.id))
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.status, "accepted")));

  if (acceptedContacts.length === 0) {
    res.json([]);
    return;
  }

  const contactUserIds = acceptedContacts.map(c => c.contactUserId);

  const sharedSessions = await db
    .select({
      otherUserId: sessionParticipantsTable.userId,
      sessionId: sessionParticipantsTable.sessionId,
    })
    .from(sessionParticipantsTable)
    .where(
      and(
        inArray(sessionParticipantsTable.userId, contactUserIds),
        eq(sessionParticipantsTable.status, "joined"),
      )
    );

  const sharedSessionIds = [...new Set(sharedSessions.map(s => s.sessionId))];

  type MessageCount = { sessionId: number; count: number; lastAt: Date | null };
  let msgStats: MessageCount[] = [];

  if (sharedSessionIds.length > 0) {
    msgStats = await db
      .select({
        sessionId: messagesTable.sessionId,
        count: sql<number>`COUNT(*)::int`,
        lastAt: sql<Date | null>`MAX(${messagesTable.createdAt})`,
      })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.senderId, userId),
          inArray(messagesTable.sessionId, sharedSessionIds),
        )
      )
      .groupBy(messagesTable.sessionId) as MessageCount[];
  }

  const sessionStatMap = new Map(msgStats.map(s => [s.sessionId, s]));

  const contactMap = new Map(acceptedContacts.map(c => [c.contactUserId, c]));

  const contactStats = contactUserIds.map(contactId => {
    const contactSessions = sharedSessions.filter(s => s.otherUserId === contactId);
    let totalMessages = 0;
    let lastMessageAt: Date | null = null;

    for (const cs of contactSessions) {
      const stat = sessionStatMap.get(cs.sessionId);
      if (stat) {
        totalMessages += stat.count;
        if (!lastMessageAt || (stat.lastAt && stat.lastAt > lastMessageAt)) {
          lastMessageAt = stat.lastAt;
        }
      }
    }

    return {
      contactUserId: contactId,
      name: contactMap.get(contactId)?.name ?? "",
      username: contactMap.get(contactId)?.username ?? "",
      avatarUrl: contactMap.get(contactId)?.avatarUrl ?? null,
      totalMessages,
      lastMessageAt,
    };
  });

  contactStats.sort((a, b) => {
    if (b.totalMessages !== a.totalMessages) return b.totalMessages - a.totalMessages;
    if (b.lastMessageAt && a.lastMessageAt) return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
    if (b.lastMessageAt) return 1;
    if (a.lastMessageAt) return -1;
    return 0;
  });

  const whitelist = await db
    .select({ allowedContactId: presenceWhitelistTable.allowedContactId })
    .from(presenceWhitelistTable)
    .where(eq(presenceWhitelistTable.userId, userId));

  const whitelistedSet = new Set(whitelist.map(w => w.allowedContactId));

  res.json(
    contactStats.map(c => ({
      contactUserId: c.contactUserId,
      name: c.name,
      username: c.username,
      avatarUrl: c.avatarUrl,
      isWhitelisted: whitelistedSet.has(c.contactUserId),
    }))
  );
});

export default router;
