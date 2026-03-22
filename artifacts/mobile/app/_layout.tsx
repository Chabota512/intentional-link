import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Stack, router as expoRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { AppState, Platform, View, Text, StyleSheet, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import Colors from "@/constants/colors";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PresenceDialog } from "@/components/PresenceDialog";
import { AuthProvider } from "@/context/AuthContext";
import { LocalDiscoveryProvider } from "@/context/LocalDiscoveryContext";
import { SocketProvider } from "@/context/SocketContext";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { usePushNotifications } from "@/hooks/usePushNotifications";

SplashScreen.preventAutoHideAsync();

focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener("change", (status) => {
    if (Platform.OS !== "web") {
      setFocused(status === "active");
    }
  });
  return () => subscription.remove();
});

const queryClient = new QueryClient();

function OfflineBanner() {
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();

  if (isConnected !== false) return null;

  return (
    <View style={[styles.offlineBanner, { paddingTop: insets.top + 4 }]}>
      <Feather name="wifi-off" size={14} color="#fff" />
      <Text style={styles.offlineText}>No internet connection</Text>
    </View>
  );
}

function HeartbeatProvider({ children }: { children: React.ReactNode }) {
  useHeartbeat();
  usePushNotifications();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (data?.type === "incoming-call" && data?.sessionId) {
        const sessionId = data.sessionId as number;
        const mode = (data.mode as string) ?? "video";
        expoRouter.push(`/session/call/${sessionId}?mode=${mode}` as any);
      }
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="session/[id]" options={{ presentation: "card" }} />
        <Stack.Screen name="session/new" options={{ presentation: "modal" }} />
        <Stack.Screen name="contacts/add" options={{ presentation: "modal" }} />
        <Stack.Screen name="privacy" options={{ presentation: "card" }} />
        <Stack.Screen name="notifications-settings" options={{ presentation: "card" }} />
        <Stack.Screen name="contact-us" options={{ presentation: "card" }} />
      </Stack>
      <OfflineBanner />
      <PresenceDialog />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Feather.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const colorScheme = useColorScheme();
  const bgColor = Colors[colorScheme === "dark" ? "dark" : "light"].background;

  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: bgColor }} />;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SocketProvider>
              <LocalDiscoveryProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <HeartbeatProvider>
                      <RootLayoutNav />
                    </HeartbeatProvider>
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </LocalDiscoveryProvider>
            </SocketProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1C2338",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 10,
    zIndex: 9999,
  },
  offlineText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
