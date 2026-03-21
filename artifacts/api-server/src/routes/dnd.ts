import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  contactsTable,
  userDndSettingsTable,
  dndWhitelistTable,
} from "@workspace/db";
import { saveNotification } from "../lib/pushNotifications";

const router: IRouter = Router();

const dndEndingTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleDndEndingAlert(userId: number, dndDurationMinutes: number) {
  if (dndEndingTimers.has(userId)) {
    clearTimeout(dndEndingTimers.get(userId)!);
    dndEndingTimers.delete(userId);
  }
  const alertAfterMs = (dndDurationMinutes - 5) * 60 * 1000;
  if (alertAfterMs <= 0) return;
  const timer = setTimeout(async () => {
    dndEndingTimers.delete(userId);
    try {
      await saveNotification(userId, "dnd_ending", "Do Not Disturb Ending Soon", "Your Do Not Disturb will turn off in 5 minutes.");
    } catch (err) {
      console.error("[dnd] Failed to send DND ending notification:", err);
    }
  }, alertAfterMs);
  dndEndingTimers.set(userId, timer);
}

function cancelDndEndingAlert(userId: number) {
  if (dndEndingTimers.has(userId)) {
    clearTimeout(dndEndingTimers.get(userId)!);
    dndEndingTimers.delete(userId);
  }
}

function authMiddleware(req: any, res: any, next: any) {
  const userId = parseInt(req.headers["x-user-id"] as string, 10);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  req.userId = userId;
  next();
}

async function getOrCreateDnd(userId: number) {
  const [existing] = await db
    .select()
    .from(userDndSettingsTable)
    .where(eq(userDndSettingsTable.userId, userId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(userDndSettingsTable)
    .values({ userId, isDndActive: false, notificationVolume: 100, updatedAt: new Date() })
    .returning();
  return created;
}

router.get("/users/dnd", authMiddleware, async (req: any, res): Promise<void> => {
  const userId = req.userId as number;
  let settings = await getOrCreateDnd(userId);

  // Auto-expire DND if the duration has passed
  if (settings.isDndActive && settings.dndExpiresAt && new Date() >= new Date(settings.dndExpiresAt)) {
    const now = new Date();
    await db
      .update(userDndSettingsTable)
      .set({ isDndActive: false, activatedAt: null, dndExpiresAt: null, updatedAt: now })
      .where(eq(userDndSettingsTable.userId, userId));
    await db.delete(dndWhitelistTable).where(eq(dndWhitelistTable.userId, userId));
    settings = { ...settings, isDndActive: false, activatedAt: null, dndExpiresAt: null };
  }

  const whitelist = await db
    .select({ contactUserId: dndWhitelistTable.contactUserId })
    .from(dndWhitelistTable)
    .where(eq(dndWhitelistTable.userId, userId));

  res.json({
    isDndActive: settings.isDndActive,
    scheduledStartTime: settings.scheduledStartTime,
    scheduledEndTime: settings.scheduledEndTime,
    scheduledDays: settings.scheduledDays ?? [],
    quietHourSchedules: settings.quietHourSchedules ? JSON.parse(settings.quietHourSchedules) : [],
    notificationVolume: settings.notificationVolume,
    activatedAt: settings.activatedAt,
    dndExpiresAt: settings.dndExpiresAt,
    whitelistedContactIds: whitelist.map(w => w.contactUserId),
  });
});

router.put("/users/dnd", authMiddleware, async (req: any, res): Promise<void> => {
  const userId = req.userId as number;
  const {
    isDndActive,
    scheduledStartTime,
    scheduledEndTime,
    scheduledDays,
    quietHourSchedules,
    notificationVolume,
    whitelistedContactIds,
    dndDurationMinutes, // null = indefinite, number = minutes until auto-off
  } = req.body;

  if (notificationVolume !== undefined) {
    const vol = Number(notificationVolume);
    if (!Number.isFinite(vol) || vol < 0 || vol > 100) {
      res.status(400).json({ error: "notificationVolume must be 0–100" });
      return;
    }
  }

  const now = new Date();
  const setFields: any = { updatedAt: now };
  if (isDndActive !== undefined) {
    setFields.isDndActive = isDndActive;
    if (isDndActive) {
      setFields.activatedAt = now;
      // Set expiry if a duration was provided
      if (dndDurationMinutes != null && Number.isFinite(Number(dndDurationMinutes)) && Number(dndDurationMinutes) > 0) {
        const expiresAt = new Date(now.getTime() + Number(dndDurationMinutes) * 60 * 1000);
        setFields.dndExpiresAt = expiresAt;
      } else {
        setFields.dndExpiresAt = null;
      }
    } else {
      setFields.activatedAt = null;
      setFields.dndExpiresAt = null;
    }
  }
  if (scheduledStartTime !== undefined) setFields.scheduledStartTime = scheduledStartTime;
  if (scheduledEndTime !== undefined) setFields.scheduledEndTime = scheduledEndTime;
  if (scheduledDays !== undefined) setFields.scheduledDays = scheduledDays;
  if (quietHourSchedules !== undefined) setFields.quietHourSchedules = JSON.stringify(quietHourSchedules);
  if (notificationVolume !== undefined) setFields.notificationVolume = Number(notificationVolume);

  await db
    .insert(userDndSettingsTable)
    .values({ userId, isDndActive: isDndActive ?? false, notificationVolume: notificationVolume ?? 100, updatedAt: now })
    .onConflictDoUpdate({ target: userDndSettingsTable.userId, set: setFields });

  if (isDndActive === false) {
    cancelDndEndingAlert(userId);
    await db.delete(dndWhitelistTable).where(eq(dndWhitelistTable.userId, userId));
  } else if (isDndActive === true) {
    if (dndDurationMinutes != null && Number.isFinite(Number(dndDurationMinutes)) && Number(dndDurationMinutes) > 5) {
      scheduleDndEndingAlert(userId, Number(dndDurationMinutes));
    }
  }
  if (isDndActive === true && Array.isArray(whitelistedContactIds)) {
    await db.delete(dndWhitelistTable).where(eq(dndWhitelistTable.userId, userId));
    if (whitelistedContactIds.length > 0) {
      await db.insert(dndWhitelistTable).values(
        whitelistedContactIds.map((cid: number) => ({ userId, contactUserId: cid }))
      );
    }
  }

  res.json({ ok: true });
});

router.get("/users/dnd/contacts", authMiddleware, async (req: any, res): Promise<void> => {
  const userId = req.userId as number;

  const accepted = await db
    .select({
      contactUserId: contactsTable.contactUserId,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(contactsTable)
    .innerJoin(usersTable, eq(contactsTable.contactUserId, usersTable.id))
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.status, "accepted")));

  const whitelist = await db
    .select({ contactUserId: dndWhitelistTable.contactUserId })
    .from(dndWhitelistTable)
    .where(eq(dndWhitelistTable.userId, userId));

  const whitelistedSet = new Set(whitelist.map(w => w.contactUserId));

  res.json(accepted.map(c => ({
    contactUserId: c.contactUserId,
    name: c.name,
    username: c.username,
    avatarUrl: c.avatarUrl,
    isWhitelisted: whitelistedSet.has(c.contactUserId),
  })));
});

export default router;
