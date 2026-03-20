import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useApi } from "@/hooks/useApi";

const EXPO_PROJECT_ID = "8bf968f3-4d7e-434b-8a10-23281a087dd9";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications() {
  const { user } = useAuth();
  const { put } = useApi();
  const registered = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const sessionId = data?.sessionId;
      const type = data?.type;

      if (sessionId) {
        if (type === "incoming-call") {
          router.push(`/session/call/${sessionId}`);
        } else {
          router.push(`/session/${sessionId}`);
        }
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!user || registered.current) return;

    const register = async () => {
      try {
        if (Platform.OS === "web") return;

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== "granted") return;

        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: EXPO_PROJECT_ID,
        });

        const pushToken = tokenData.data;
        if (!pushToken) return;

        await put("/users/me", { pushToken });
        registered.current = true;
      } catch {
      }
    };

    register();
  }, [user?.id]);
}
