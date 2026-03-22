import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import { useSocket, IncomingMessageData } from "@/context/SocketContext";

const AUTO_DISMISS_MS = 4000;

export function IncomingMessageBanner() {
  const { incomingMessage, dismissIncomingMessage } = useSocket();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-200)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const msgKeyRef = useRef(0);
  const [visible, setVisible] = useState(false);
  const [displayed, setDisplayed] = useState<IncomingMessageData | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  useEffect(() => {
    if (incomingMessage) {
      msgKeyRef.current += 1;
      const key = msgKeyRef.current;
      setDisplayed(incomingMessage);
      setVisible(true);

      slideAnim.setValue(-200);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();

      if (Platform.OS !== "web") {
        (async () => {
          try {
            if (soundRef.current) {
              await soundRef.current.unloadAsync();
              soundRef.current = null;
            }
            const { sound } = await Audio.Sound.createAsync(
              require("../assets/sounds/notification.mp3"),
              { shouldPlay: true, volume: 1.0 }
            );
            soundRef.current = sound;
            sound.setOnPlaybackStatusUpdate((status) => {
              if ("didJustFinish" in status && status.didJustFinish) {
                sound.unloadAsync();
                soundRef.current = null;
              }
            });
          } catch {}
        })();
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        animateOut(key);
      }, AUTO_DISMISS_MS);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [incomingMessage]);

  function animateOut(forKey: number) {
    Animated.timing(slideAnim, {
      toValue: -200,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      if (msgKeyRef.current === forKey) {
        setVisible(false);
        setDisplayed(null);
        dismissIncomingMessage();
      }
    });
  }

  function handleTap() {
    if (!displayed) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setDisplayed(null);
    dismissIncomingMessage();
    router.push(`/session/${displayed.sessionId}` as any);
  }

  function handleDismiss() {
    animateOut(msgKeyRef.current);
  }

  if (!visible || !displayed) return null;

  const iconName: keyof typeof Feather.glyphMap =
    displayed.type === "image" ? "image" :
    displayed.type === "file" ? "file" :
    displayed.type === "voice" ? "mic" : "message-circle";

  const initials = (displayed.senderName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingTop: insets.top + 8, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <Pressable
        style={styles.inner}
        onPress={handleTap}
        accessibilityRole="button"
        accessibilityLabel={`New message from ${displayed.senderName}`}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>

        <View style={styles.info}>
          <Text style={styles.senderName} numberOfLines={1}>
            {displayed.senderName}
          </Text>
          <View style={styles.contentRow}>
            <Feather name={iconName} size={13} color="rgba(255,255,255,0.55)" />
            <Text style={styles.messageText} numberOfLines={1}>
              {displayed.content}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.closeBtn}
          onPress={handleDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
        >
          <Feather name="x" size={18} color="rgba(255,255,255,0.5)" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99998,
    elevation: 99998,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(14, 24, 36, 0.97)",
    borderRadius: 16,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 20,
    borderWidth: 1,
    borderColor: "rgba(74, 174, 200, 0.15)",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#4AAEC8",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  senderName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  messageText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});
