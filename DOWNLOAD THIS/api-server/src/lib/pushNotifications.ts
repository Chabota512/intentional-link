import Expo from "expo-server-sdk";

const expo = new Expo();

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
  } catch {
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
  } catch {
  }
}
