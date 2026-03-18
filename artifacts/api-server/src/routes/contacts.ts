import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, contactsTable, usersTable } from "@workspace/db";
import { AddContactBody, GetContactsResponseItem } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/contacts", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const results = await db
    .select({
      id: contactsTable.id,
      userId: contactsTable.userId,
      createdAt: contactsTable.createdAt,
      contactUserId: contactsTable.contactUserId,
      contactName: usersTable.name,
      contactUsername: usersTable.username,
      contactCreatedAt: usersTable.createdAt,
    })
    .from(contactsTable)
    .innerJoin(usersTable, eq(contactsTable.contactUserId, usersTable.id))
    .where(eq(contactsTable.userId, userId));

  const contacts = results.map(r => GetContactsResponseItem.parse({
    id: r.id,
    userId: r.userId,
    createdAt: r.createdAt,
    contactUser: {
      id: r.contactUserId,
      name: r.contactName,
      username: r.contactUsername,
      createdAt: r.contactCreatedAt,
    },
  }));

  res.json(contacts);
});

router.post("/contacts", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = AddContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { contactUserId } = parsed.data;

  if (contactUserId === userId) {
    res.status(400).json({ error: "Cannot add yourself as a contact" });
    return;
  }

  const [contactUser] = await db.select().from(usersTable).where(eq(usersTable.id, contactUserId)).limit(1);
  if (!contactUser) {
    res.status(400).json({ error: "User not found" });
    return;
  }

  const existing = await db.select().from(contactsTable)
    .where(and(eq(contactsTable.userId, userId), eq(contactsTable.contactUserId, contactUserId)))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Already a contact" });
    return;
  }

  const [contact] = await db.insert(contactsTable).values({ userId, contactUserId }).returning();

  res.status(201).json(GetContactsResponseItem.parse({
    id: contact.id,
    userId: contact.userId,
    createdAt: contact.createdAt,
    contactUser: {
      id: contactUser.id,
      name: contactUser.name,
      username: contactUser.username,
      createdAt: contactUser.createdAt,
    },
  }));
});

router.delete("/contacts/:contactId", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  const userId = parseInt(userIdStr, 10);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const raw = Array.isArray(req.params.contactId) ? req.params.contactId[0] : req.params.contactId;
  const contactId = parseInt(raw, 10);

  const [deleted] = await db.delete(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.userId, userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
