import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Vibration,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSocket, IncomingCallData } from "@/context/SocketContext";

const AUTO_DISMISS_MS = 45000;

export function IncomingCallBanner() {
  const { incomingCall, dismissIncomingCall } = useSocket();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-300)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callKeyRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [displayedCall, setDisplayedCall] = useState<IncomingCallData | null>(null);

  function makeCallKey(call: IncomingCallData) {
    return `${call.sessionId}-${call.callerId}`;
  }

  useEffect(() => {
    if (incomingCall) {
      const key = makeCallKey(incomingCall);
      callKeyRef.current = key;
      setDisplayedCall(incomingCall);
      setVisible(true);

      slideAnim.setValue(-300);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 12,
      }).start();

      if (pulseLoopRef.current) pulseLoopRef.current.stop();
      pulseAnim.setValue(1);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current = loop;
      loop.start();

      if (Platform.OS !== "web") {
        Vibration.vibrate([0, 500, 300, 500, 300, 500], false);
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        animateOut(key);
      }, AUTO_DISMISS_MS);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [incomingCall]);

  function animateOut(forKey: string) {
    if (Platform.OS !== "web") Vibration.cancel();
    if (pulseLoopRef.current) pulseLoopRef.current.stop();

    Animated.timing(slideAnim, {
      toValue: -300,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      if (callKeyRef.current === forKey) {
        setVisible(false);
        setDisplayedCall(null);
        dismissIncomingCall();
      }
    });
  }

  function handleAccept() {
    if (!displayedCall) return;
    const { sessionId, mode } = displayedCall;
    if (Platform.OS !== "web") Vibration.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pulseLoopRef.current) pulseLoopRef.current.stop();
    setVisible(false);
    setDisplayedCall(null);
    dismissIncomingCall();
    router.push(`/session/call/${sessionId}?mode=${mode}` as any);
  }

  function handleDecline() {
    const key = callKeyRef.current;
    if (key) animateOut(key);
  }

  if (!visible || !displayedCall) return null;

  const isVoice = displayedCall.mode === "voice";

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingTop: insets.top + 12, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.inner}>
        <Animated.View style={[styles.iconCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Feather name={isVoice ? "phone-incoming" : "video"} size={28} color="#fff" />
        </Animated.View>

        <View style={styles.info}>
          <Text style={styles.callerName} numberOfLines={1}>
            {displayedCall.callerName}
          </Text>
          <Text style={styles.callType}>
            Incoming {isVoice ? "voice" : "video"} call…
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={handleDecline}
            accessibilityRole="button"
            accessibilityLabel="Decline call"
          >
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.acceptBtn]}
            onPress={handleAccept}
            accessibilityRole="button"
            accessibilityLabel={`Accept ${isVoice ? "voice" : "video"} call`}
          >
            <Feather name={isVoice ? "phone" : "video"} size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: "rgba(10, 21, 32, 0.97)",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 25,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#4AAEC8",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  callerName: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  callType: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.65)",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  declineBtn: {
    backgroundColor: "#FF3B30",
  },
  acceptBtn: {
    backgroundColor: "#34C759",
  },
});
