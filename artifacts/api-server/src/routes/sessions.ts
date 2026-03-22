import { Router, type IRouter } from "express";
import { eq, and, inArray, ne, desc, count as drizzleCount, sql, gt } from "drizzle-orm";
import { db, sessionsTable, sessionParticipantsTable, usersTable, messagesTable, sessionReadCursorsTable, messageReactionsTable, pendingInvitesTable } from "@workspace/db";
import {
  CreateSessionBody,
  UpdateSessionBody,
  InviteToSessionBody,
  GetSessionResponse,
} from "@workspace/api-zod";
import { sendPushNotification, saveNotification } from "../lib/pushNotifications";
import { emitToUser } from "../lib/socketio";

const router: IRouter = Router();

async function getSessionWithParticipants(sessionId: number) {
  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
    if (!session) return null;

    const participants = await db
      .select({
        id: sessionParticipantsTable.id,
        userId: sessionParticipantsTable.userId,
        sessionId: sessionParticipantsTable.sessionId,
        status: sessionParticipantsTable.status,
        joinedAt: sessionParticipantsTable.joinedAt,
        userName: usersTable.name,
        userUsername: usersTable.username,
        userAvatarUrl: usersTable.avatarUrl,
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
      avatarUrl: usersTable.avatarUrl,
      lastSeenAt: usersTable.lastSeenAt,
    }).from(usersTable).where(eq(usersTable.id, session.creatorId)).limit(1);

    const parsed = GetSessionResponse.parse({
      ...session,
      participants: participants.map(p => ({
        id: p.id,
        userId: p.userId,
        sessionId: p.sessionId,
        status: p.status,
        joinedAt: p.joinedAt ?? null,
        user: { id: p.userId, name: p.userName, username: p.userUsername, avatarUrl: p.userAvatarUrl ?? null, createdAt: p.userCreatedAt, lastSeenAt: p.userLastSeenAt },
      })),
    });

    return { ...parsed, creator: creator ? { ...creator, avatarUrl: creator.avatarUrl ?? null } : null };
  } catch (err) {
    console.error("[getSessionWithParticipants] Error:", err);
    throw err;
  }
}

async function getSessionMembership(sessionId: number, userId: number) {
  try {
    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).limit(1);
    if (!session) return null;

    const isCreator = session.creatorId === userId;

    const [participant] = await db.select().from(sessionParticipantsTable)
      .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)))
      .limit(1);

    return { session, isCreator, participant: participant ?? null };
  } catch (err) {
    console.error("[getSessionMembership] Error:", err);
    throw err;
  }
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
    .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);

  const sessionIds = allSessions.map(s => s.id);

  const [lastMessages, readCursors, messageCounts] = await Promise.all([
    sessionIds.length > 0
      ? db.execute(sql`
          SELECT DISTINCT ON (m.session_id)
            m.session_id, m.id, m.content, m.type, m.sender_id, m.created_at,
            u.name as sender_name
          FROM messages m
          JOIN users u ON u.id = m.sender_id
          WHERE m.session_id = ANY(ARRAY[${sql.join(sessionIds.map(id => sql`${id}`), sql`, `)}]::int[])
          ORDER BY m.session_id, m.id DESC
        `)
      : { rows: [] },
    sessionIds.length > 0
      ? db.select({
          sessionId: sessionReadCursorsTable.sessionId,
          lastReadMessageId: sessionReadCursorsTable.lastReadMessageId,
        })
        .from(sessionReadCursorsTable)
        .where(and(
          inArray(sessionReadCursorsTable.sessionId, sessionIds),
          eq(sessionReadCursorsTable.userId, userId)
        ))
      : [],
    sessionIds.length > 0
      ? db.execute(sql`
          SELECT session_id, COUNT(*)::int as total
          FROM messages
          WHERE session_id = ANY(ARRAY[${sql.join(sessionIds.map(id => sql`${id}`), sql`, `)}]::int[])
          GROUP BY session_id
        `)
      : { rows: [] },
  ]);

  const lastMsgMap = new Map<number, any>();
  for (const row of (lastMessages as any).rows) {
    lastMsgMap.set(row.session_id, row);
  }

  const cursorMap = new Map<number, number>();
  for (const c of readCursors as any[]) {
    cursorMap.set(c.sessionId, c.lastReadMessageId);
  }

  const totalMap = new Map<number, number>();
  for (const row of (messageCounts as any).rows) {
    totalMap.set(row.session_id, row.total);
  }

  const unreadCounts = new Map<number, number>();
  if (sessionIds.length > 0) {
    const cursoredIds = sessionIds.filter(id => cursorMap.has(id));
    const noCursorIds = sessionIds.filter(id => !cursorMap.has(id));

    if (cursoredIds.length > 0) {
      for (const sid of cursoredIds) {
        const cursor = cursorMap.get(sid)!;
        const [result] = await db.select({ count: drizzleCount() })
          .from(messagesTable)
          .where(and(
            eq(messagesTable.sessionId, sid),
            gt(messagesTable.id, cursor),
            ne(messagesTable.senderId, userId)
          ));
        unreadCounts.set(sid, result?.count ?? 0);
      }
    }

    if (noCursorIds.length > 0) {
      for (const sid of noCursorIds) {
        const [result] = await db.select({ count: drizzleCount() })
          .from(messagesTable)
          .where(and(
            eq(messagesTable.sessionId, sid),
            ne(messagesTable.senderId, userId)
          ));
        unreadCounts.set(sid, result?.count ?? 0);
      }
    }
  }

  allSessions.sort((a, b) => {
    const aMsg = lastMsgMap.get(a.id);
    const bMsg = lastMsgMap.get(b.id);
    const aTime = aMsg ? new Date(aMsg.created_at).getTime() : new Date(a.createdAt).getTime();
    const bTime = bMsg ? new Date(bMsg.created_at).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  const results = await Promise.all(allSessions.map(async (s) => {
    const full = await getSessionWithParticipants(s.id);
    if (!full) return null;
    const lastMsg = lastMsgMap.get(s.id);
    return {
      ...full,
      lastMessage: lastMsg ? {
        id: lastMsg.id,
        content: lastMsg.content,
        type: lastMsg.type,
        senderId: lastMsg.sender_id,
        senderName: lastMsg.sender_name,
        createdAt: lastMsg.created_at,
      } : null,
      unreadCount: unreadCounts.get(s.id) ?? 0,
      messageCount: totalMap.get(s.id) ?? 0,
    };
  }));
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

  const imageUrl = (req.body as any).imageUrl ?? null;
  const showPastMessages = (req.body as any).showPastMessages === true;

  const [session] = await db.insert(sessionsTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    imageUrl: typeof imageUrl === "string" ? imageUrl : null,
    creatorId: userId,
    status: "active",
    showPastMessages,
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

  if (parsed.data.status === "completed" && result) {
    (async () => {
      try {
        const [ender] = await db.select({ name: usersTable.name })
          .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        const enderName = ender?.name || "Someone";
        const otherParticipants = result.participants.filter(p => p.userId !== userId && p.status !== "declined");
        for (const p of otherParticipants) {
          await saveNotification(p.userId, "chat_completed", "Chat Ended", `${enderName} ended the chat "${session.title}"`, { sessionId });
        }
      } catch (err) {
        console.error("[sessions] Failed to send chat completion notification:", err);
      }
    })();
  }
});

router.delete("/sessions/:sessionId", async (req, res): Promise<void> => {
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

  const isMember = session.creatorId === userId;
  if (!isMember) {
    const [participant] = await db.select().from(sessionParticipantsTable)
      .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId), eq(sessionParticipantsTable.status, "joined")))
      .limit(1);
    if (!participant) {
      res.status(403).json({ error: "Only joined session members can delete this session" });
      return;
    }
  }

  const sessionMessages = await db.select({ id: messagesTable.id }).from(messagesTable).where(eq(messagesTable.sessionId, sessionId));
  const messageIds = sessionMessages.map((m) => m.id);
  if (messageIds.length > 0) {
    await db.delete(messageReactionsTable).where(inArray(messageReactionsTable.messageId, messageIds));
  }
  await db.delete(messagesTable).where(eq(messagesTable.sessionId, sessionId));
  await db.delete(sessionReadCursorsTable).where(eq(sessionReadCursorsTable.sessionId, sessionId));
  await db.delete(sessionParticipantsTable).where(eq(sessionParticipantsTable.sessionId, sessionId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));

  res.sendStatus(204);
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

  if (!membership.isCreator && (!membership.participant || membership.participant.status !== "joined")) {
    res.status(403).json({ error: "Only joined participants can invite others" });
    return;
  }

  const parsed = InviteToSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [inviter] = await db.select({ name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (membership.isCreator) {
    const existing = await db.select().from(sessionParticipantsTable)
      .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, parsed.data.userId)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(sessionParticipantsTable).values({
        sessionId,
        userId: parsed.data.userId,
        status: "invited",
      });
    } else if (existing[0].status !== "joined") {
      await db.update(sessionParticipantsTable)
        .set({ status: "invited", joinedAt: null })
        .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, parsed.data.userId)));
    }

    const [invitedUser] = await db.select({ id: usersTable.id, pushToken: usersTable.pushToken, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, parsed.data.userId)).limit(1);

    if (invitedUser && inviter) {
      const inviteTitle = "Chat Invitation";
      const inviteBody = `${inviter.name} invited you to join "${membership.session.title}"`;
      const inviteData = { sessionId, type: "chat-invite" };
      await saveNotification(invitedUser.id, "invite", inviteTitle, inviteBody, inviteData);
      emitToUser(parsed.data.userId, "session_invite", { sessionId, fromUserId: userId, title: membership.session.title });
      if (invitedUser.pushToken) {
        await sendPushNotification(invitedUser.pushToken, inviteTitle, inviteBody, inviteData);
      }
    }
  } else {
    const [existingPending] = await db.select().from(pendingInvitesTable)
      .where(and(
        eq(pendingInvitesTable.sessionId, sessionId),
        eq(pendingInvitesTable.invitedUserId, parsed.data.userId),
        eq(pendingInvitesTable.status, "pending"),
      )).limit(1);

    if (!existingPending) {
      await db.insert(pendingInvitesTable).values({
        sessionId,
        invitedUserId: parsed.data.userId,
        requestedByUserId: userId,
      });
    }

    const [invitedUser] = await db.select({ name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, parsed.data.userId)).limit(1);

    const otherMemberIds: number[] = [];
    if (membership.session.creatorId !== userId) otherMemberIds.push(membership.session.creatorId);
    const otherParticipants = await db.select({ userId: sessionParticipantsTable.userId })
      .from(sessionParticipantsTable)
      .where(and(
        eq(sessionParticipantsTable.sessionId, sessionId),
        eq(sessionParticipantsTable.status, "joined"),
        ne(sessionParticipantsTable.userId, userId),
      ));
    otherParticipants.forEach(p => { if (!otherMemberIds.includes(p.userId)) otherMemberIds.push(p.userId); });

    for (const memberId of otherMemberIds) {
      emitToUser(memberId, "pending_invite_request", {
        sessionId,
        invitedUserName: invitedUser?.name || "Someone",
        requestedByName: inviter?.name || "A member",
      });
    }
  }

  const result = await getSessionWithParticipants(sessionId);
  res.json(result);
});

router.get("/sessions/:sessionId/pending-invites", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  if (!userIdStr) { res.status(401).json({ error: "Missing x-user-id header" }); return; }
  const userId = parseInt(userIdStr, 10);
  const sessionId = parseInt(req.params.sessionId, 10);

  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) { res.status(404).json({ error: "Session not found" }); return; }
  if (!membership.isCreator && (!membership.participant || membership.participant.status !== "joined")) {
    res.status(403).json({ error: "Only session members can view pending invites" }); return;
  }

  const pendingList = await db
    .select({
      id: pendingInvitesTable.id,
      sessionId: pendingInvitesTable.sessionId,
      invitedUserId: pendingInvitesTable.invitedUserId,
      requestedByUserId: pendingInvitesTable.requestedByUserId,
      status: pendingInvitesTable.status,
      createdAt: pendingInvitesTable.createdAt,
      invitedUserName: usersTable.name,
      invitedUserAvatarUrl: usersTable.avatarUrl,
    })
    .from(pendingInvitesTable)
    .leftJoin(usersTable, eq(usersTable.id, pendingInvitesTable.invitedUserId))
    .where(and(
      eq(pendingInvitesTable.sessionId, sessionId),
      eq(pendingInvitesTable.status, "pending"),
    ));

  const enriched = await Promise.all(pendingList.map(async (pi) => {
    const [requester] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, pi.requestedByUserId)).limit(1);
    return { ...pi, requestedByName: requester?.name || "Unknown" };
  }));

  res.json(enriched);
});

router.post("/sessions/:sessionId/pending-invites/:inviteId/approve", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  if (!userIdStr) { res.status(401).json({ error: "Missing x-user-id header" }); return; }
  const userId = parseInt(userIdStr, 10);
  const sessionId = parseInt(req.params.sessionId, 10);
  const inviteId = parseInt(req.params.inviteId, 10);

  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) { res.status(404).json({ error: "Session not found" }); return; }
  if (!membership.isCreator && (!membership.participant || membership.participant.status !== "joined")) {
    res.status(403).json({ error: "Only session members can approve invites" }); return;
  }

  const [pending] = await db.select().from(pendingInvitesTable)
    .where(and(eq(pendingInvitesTable.id, inviteId), eq(pendingInvitesTable.sessionId, sessionId), eq(pendingInvitesTable.status, "pending")))
    .limit(1);

  if (!pending) { res.status(404).json({ error: "Pending invite not found" }); return; }

  if (pending.requestedByUserId === userId) {
    res.status(403).json({ error: "You cannot approve your own invite request" }); return;
  }

  await db.update(pendingInvitesTable)
    .set({ status: "approved", approvedByUserId: userId })
    .where(eq(pendingInvitesTable.id, inviteId));

  const existing = await db.select().from(sessionParticipantsTable)
    .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, pending.invitedUserId)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(sessionParticipantsTable).values({
      sessionId,
      userId: pending.invitedUserId,
      status: "invited",
    });
  } else if (existing[0].status !== "joined") {
    await db.update(sessionParticipantsTable)
      .set({ status: "invited", joinedAt: null })
      .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, pending.invitedUserId)));
  }

  const [invitedUser] = await db.select({ id: usersTable.id, pushToken: usersTable.pushToken, name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, pending.invitedUserId)).limit(1);
  const [approver] = await db.select({ name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (invitedUser) {
    const inviteTitle = "Chat Invitation";
    const inviteBody = `You've been invited to join "${membership.session.title}"`;
    const inviteData = { sessionId, type: "chat-invite" };
    await saveNotification(invitedUser.id, "invite", inviteTitle, inviteBody, inviteData);
    emitToUser(pending.invitedUserId, "session_invite", { sessionId, fromUserId: userId, title: membership.session.title });
    if (invitedUser.pushToken) {
      await sendPushNotification(invitedUser.pushToken, inviteTitle, inviteBody, inviteData);
    }
  }

  emitToUser(pending.requestedByUserId, "pending_invite_approved", {
    sessionId,
    invitedUserName: invitedUser?.name || "Someone",
    approvedByName: approver?.name || "A member",
  });

  const result = await getSessionWithParticipants(sessionId);
  res.json(result);
});

router.post("/sessions/:sessionId/pending-invites/:inviteId/reject", async (req, res): Promise<void> => {
  const userIdStr = req.headers["x-user-id"] as string;
  if (!userIdStr) { res.status(401).json({ error: "Missing x-user-id header" }); return; }
  const userId = parseInt(userIdStr, 10);
  const sessionId = parseInt(req.params.sessionId, 10);
  const inviteId = parseInt(req.params.inviteId, 10);

  const membership = await getSessionMembership(sessionId, userId);
  if (!membership) { res.status(404).json({ error: "Session not found" }); return; }
  if (!membership.isCreator && (!membership.participant || membership.participant.status !== "joined")) {
    res.status(403).json({ error: "Only session members can reject invites" }); return;
  }

  await db.update(pendingInvitesTable)
    .set({ status: "rejected" })
    .where(and(eq(pendingInvitesTable.id, inviteId), eq(pendingInvitesTable.sessionId, sessionId), eq(pendingInvitesTable.status, "pending")));

  res.json({ success: true });
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
      .set({ status: "joined", joinedAt: new Date() })
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
        .set({ status: "joined", joinedAt: new Date() })
        .where(and(eq(sessionParticipantsTable.sessionId, sessionId), eq(sessionParticipantsTable.userId, userId)));
    }
  } else {
    await db.insert(sessionParticipantsTable).values({ sessionId, userId, status: "joined", joinedAt: new Date() });
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

router.get("/sessions/:sessionId/media", async (req, res): Promise<void> => {
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

  if (!membership.isCreator && membership.participant?.status !== "joined") {
    res.status(403).json({ error: "You are not a member of this session" });
    return;
  }

  const rawLimit = parseInt(req.query.limit as string || "50", 10);
  const limit = Math.min(Math.max(rawLimit, 1), 100);
  const rawOffset = parseInt(req.query.offset as string || "0", 10);
  const offset = Math.max(rawOffset, 0);
  const typeFilter = req.query.type as string | undefined;

  const validTypes = ["image", "video", "file", "voice"];
  if (typeFilter && !validTypes.includes(typeFilter)) {
    res.status(400).json({ error: "Invalid type filter. Use 'image', 'video', 'file', or 'voice'" });
    return;
  }
  const targetTypes = typeFilter ? [typeFilter] : validTypes;

  const media = await db.select({
    id: messagesTable.id,
    type: messagesTable.type,
    content: messagesTable.content,
    attachmentUrl: messagesTable.attachmentUrl,
    attachmentName: messagesTable.attachmentName,
    attachmentSize: messagesTable.attachmentSize,
    senderId: messagesTable.senderId,
    createdAt: messagesTable.createdAt,
  })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        inArray(messagesTable.type, targetTypes)
      )
    )
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db.select({ count: drizzleCount() })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        inArray(messagesTable.type, targetTypes)
      )
    );

  const total = totalResult?.count ?? 0;

  const senderIds = [...new Set(media.map(m => m.senderId))];
  const senders = senderIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, username: usersTable.username, avatarUrl: usersTable.avatarUrl })
        .from(usersTable)
        .where(inArray(usersTable.id, senderIds))
    : [];

  const senderMap = new Map(senders.map(s => [s.id, s]));

  const images = media.filter(m => m.type === "image").map(m => ({
    ...m,
    sender: senderMap.get(m.senderId) ?? null,
  }));

  const videos = media.filter(m => m.type === "video").map(m => ({
    ...m,
    sender: senderMap.get(m.senderId) ?? null,
  }));

  const files = media.filter(m => m.type === "file").map(m => ({
    ...m,
    sender: senderMap.get(m.senderId) ?? null,
  }));

  const voiceNotes = media.filter(m => m.type === "voice").map(m => ({
    ...m,
    sender: senderMap.get(m.senderId) ?? null,
  }));

  res.json({
    images,
    videos,
    files,
    voiceNotes,
    total,
    offset,
    limit,
  });
});

export default router;
