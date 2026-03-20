import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/context/AuthContext";
import { useApi } from "@/hooks/useApi";

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
          projectId: process.env.EXPO_PUBLIC_REPL_ID,
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
