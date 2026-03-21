import Expo from "expo-server-sdk";
import { db, notificationsTable } from "@workspace/db";
import { emitToUser } from "./socketio";

const expo = new Expo();

export async function saveNotification(
  userId: number,
  type: "message" | "call" | "invite" | "contact_request" | "contact_accepted" | "dnd_ending" | "chat_completed",
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const [saved] = await db.insert(notificationsTable).values({
      userId,
      type,
      title,
      body,
      data: data ?? {},
    }).returning();

    emitToUser(userId, "new_notification", {
      id: saved.id,
      type: saved.type,
      title: saved.title,
      body: saved.body,
      data: saved.data,
      isRead: saved.isRead,
      createdAt: saved.createdAt,
    });
  } catch (err) {
    console.error("[saveNotification] Failed to save notification:", err);
  }
}

export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!Expo.isExpoPushToken(pushToken)) return;

  try {
    const messages = [
      {
        to: pushToken,
        sound: "default" as const,
        title,
        body,
        data: data ?? {},
      },
    ];

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    console.error("[sendPushNotification] Failed:", err);
  }
}

export async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const validTokens = tokens.filter(Expo.isExpoPushToken);
  if (validTokens.length === 0) return;

  try {
    const messages = validTokens.map(to => ({
      to,
      sound: "default" as const,
      title,
      body,
      data: data ?? {},
    }));

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk);
    }
  } catch (err) {
    console.error("[sendPushNotifications] Failed:", err);
  }
}
