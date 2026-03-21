import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, contactsTable, usersTable } from "@workspace/db";
import { AddContactBody, GetContactsResponseItem } from "@workspace/api-zod";
import { sendPushNotification, saveNotification } from "../lib/pushNotifications";

const router: IRouter = Router();

function getUserId(req: any): number | null {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  return userId || null;
}

async function buildContactResponse(row: typeof contactsTable.$inferSelect) {
  const [contactUser] = await db.select().from(usersTable).where(eq(usersTable.id, row.contactUserId)).limit(1);
  if (!contactUser) return null;
  return GetContactsResponseItem.parse({
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    contactUser: {
      id: contactUser.id,
      name: contactUser.name,
      username: contactUser.username,
      avatarUrl: contactUser.avatarUrl ?? null,
      createdAt: contactUser.createdAt,
      lastSeenAt: contactUser.lastSeenAt,
    },
  });
}

router.get("/contacts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const results = await db
    .select({
      id: contactsTable.id,
      userId: contactsTable.userId,
      createdAt: contactsTable.createdAt,
      contactUserId: contactsTable.contactUserId,
      contactName: usersTable.name,
      contactUsername: usersTable.username,
      contactAvatarUrl: usersTable.avatarUrl,
      contactCreatedAt: usersTable.createdAt,
      contactLastSeenAt: usersTable.lastSeenAt,
    })
    .from(contactsTable)
    .innerJoin(usersTable, eq(contactsTable.contactUserId, usersTable.id))
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.status, "accepted")));

  const contacts = results.map(r => GetContactsResponseItem.parse({
    id: r.id,
    userId: r.userId,
    createdAt: r.createdAt,
    contactUser: {
      id: r.contactUserId,
      name: r.contactName,
      username: r.contactUsername,
      avatarUrl: r.contactAvatarUrl ?? null,
      createdAt: r.contactCreatedAt,
      lastSeenAt: r.contactLastSeenAt,
    },
  }));

  res.json(contacts);
});

router.get("/contacts/requests", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const incoming = await db
    .select({
      id: contactsTable.id,
      userId: contactsTable.userId,
      contactUserId: contactsTable.contactUserId,
      createdAt: contactsTable.createdAt,
      senderName: usersTable.name,
      senderUsername: usersTable.username,
      senderAvatarUrl: usersTable.avatarUrl,
      senderCreatedAt: usersTable.createdAt,
      senderLastSeenAt: usersTable.lastSeenAt,
    })
    .from(contactsTable)
    .innerJoin(usersTable, eq(contactsTable.userId, usersTable.id))
    .where(and(eq(contactsTable.contactUserId, userId), eq(contactsTable.status, "pending")));

  const outgoing = await db
    .select({
      id: contactsTable.id,
      userId: contactsTable.userId,
      contactUserId: contactsTable.contactUserId,
      createdAt: contactsTable.createdAt,
      recipientName: usersTable.name,
      recipientUsername: usersTable.username,
      recipientAvatarUrl: usersTable.avatarUrl,
    })
    .from(contactsTable)
    .innerJoin(usersTable, eq(contactsTable.contactUserId, usersTable.id))
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.status, "pending")));

  res.json({
    incoming: incoming.map(r => ({
      id: r.id,
      senderId: r.userId,
      senderName: r.senderName,
      senderUsername: r.senderUsername,
      senderAvatarUrl: r.senderAvatarUrl ?? null,
      createdAt: r.createdAt,
    })),
    outgoing: outgoing.map(r => ({
      id: r.id,
      recipientId: r.contactUserId,
      recipientName: r.recipientName,
      recipientUsername: r.recipientUsername,
      recipientAvatarUrl: r.recipientAvatarUrl ?? null,
      createdAt: r.createdAt,
    })),
  });
});

router.post("/contacts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = AddContactBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { contactUserId } = parsed.data;

  if (contactUserId === userId) {
    res.status(400).json({ error: "Cannot add yourself as a contact" });
    return;
  }

  const [contactUser] = await db.select().from(usersTable).where(eq(usersTable.id, contactUserId)).limit(1);
  if (!contactUser) { res.status(400).json({ error: "User not found" }); return; }

  const [existingFromMe] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.contactUserId, contactUserId)))
    .limit(1);

  if (existingFromMe) {
    if (existingFromMe.status === "accepted") {
      res.status(409).json({ error: "Already a contact" });
    } else {
      res.status(409).json({ error: "Request already sent" });
    }
    return;
  }

  const [existingFromThem] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.userId, contactUserId), eq(contactsTable.contactUserId, userId)))
    .limit(1);

  if (existingFromThem && existingFromThem.status === "accepted") {
    res.status(409).json({ error: "Already a contact" });
    return;
  }

  if (existingFromThem && existingFromThem.status === "pending") {
    await db.update(contactsTable)
      .set({ status: "accepted" })
      .where(eq(contactsTable.id, existingFromThem.id));

    const [me] = await db.insert(contactsTable)
      .values({ userId, contactUserId, status: "accepted" })
      .returning();

    const resp = await buildContactResponse(me);
    res.status(201).json(resp);
    return;
  }

  const [contact] = await db.insert(contactsTable)
    .values({ userId, contactUserId, status: "pending" })
    .returning();

  res.status(201).json({
    id: contact.id,
    status: "pending",
    recipientId: contactUserId,
    recipientName: contactUser.name,
    recipientUsername: contactUser.username,
    createdAt: contact.createdAt,
  });

  (async () => {
    try {
      const [me] = await db.select({ name: usersTable.name, pushToken: usersTable.pushToken })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      const [them] = await db.select({ pushToken: usersTable.pushToken })
        .from(usersTable)
        .where(eq(usersTable.id, contactUserId))
        .limit(1);
      if (me) {
        const senderName = me.name || "Someone";
        await saveNotification(contactUserId, "contact_request", "New Contact Request", `${senderName} wants to connect with you`, { fromUserId: userId });
        if (them?.pushToken) {
          await sendPushNotification(them.pushToken, "New Contact Request", `${senderName} wants to connect with you`, { contactUserId: userId });
        }
      }
    } catch {}
  })();
});

router.post("/contacts/requests/:requestId/accept", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const requestId = parseInt(req.params.requestId, 10);

  const [request] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.id, requestId), eq(contactsTable.contactUserId, userId), eq(contactsTable.status, "pending")))
    .limit(1);

  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  await db.update(contactsTable)
    .set({ status: "accepted" })
    .where(eq(contactsTable.id, request.id));

  const [existingReverse] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.contactUserId, request.userId)))
    .limit(1);

  if (!existingReverse) {
    await db.insert(contactsTable)
      .values({ userId, contactUserId: request.userId, status: "accepted" });
  } else {
    await db.update(contactsTable)
      .set({ status: "accepted" })
      .where(eq(contactsTable.id, existingReverse.id));
  }

  const [myRow] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.contactUserId, request.userId)))
    .limit(1);

  const resp = myRow ? await buildContactResponse(myRow) : null;
  res.json(resp);

  (async () => {
    try {
      const [accepter] = await db.select({ name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (accepter) {
        const accepterName = accepter.name || "Someone";
        await saveNotification(request.userId, "contact_accepted", "Contact Request Accepted", `${accepterName} accepted your contact request`, { fromUserId: userId });
      }
    } catch {}
  })();
});

router.post("/contacts/requests/:requestId/decline", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const requestId = parseInt(req.params.requestId, 10);

  const [deleted] = await db.delete(contactsTable)
    .where(and(eq(contactsTable.id, requestId), eq(contactsTable.contactUserId, userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  res.sendStatus(204);
});

router.delete("/contacts/:contactId/cancel", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const contactId = parseInt(req.params.contactId, 10);

  const [deleted] = await db.delete(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.userId, userId), eq(contactsTable.status, "pending")))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Pending request not found" });
    return;
  }

  res.sendStatus(204);
});

router.delete("/contacts/:contactId", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const raw = Array.isArray(req.params.contactId) ? req.params.contactId[0] : req.params.contactId;
  const contactId = parseInt(raw, 10);

  const [myRow] = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.userId, userId)))
    .limit(1);

  if (!myRow) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  await db.delete(contactsTable).where(eq(contactsTable.id, myRow.id));

  await db.delete(contactsTable)
    .where(and(eq(contactsTable.userId, myRow.contactUserId), eq(contactsTable.contactUserId, userId)));

  res.sendStatus(204);
});

export default router;
