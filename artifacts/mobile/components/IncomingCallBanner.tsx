import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Vibration,
  Platform,
  Dimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSocket, IncomingCallData } from "@/context/SocketContext";

const AUTO_DISMISS_MS = 45000;
const { width: SCREEN_W } = Dimensions.get("window");

export function IncomingCallBanner() {
  const { incomingCall, dismissIncomingCall } = useSocket();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringPulseAnim = useRef(new Animated.Value(1)).current;
  const ringOpacityAnim = useRef(new Animated.Value(0.5)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const ringLoopRef = useRef<Animated.CompositeAnimation | null>(null);
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

      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }),
      ]).start();

      if (pulseLoopRef.current) pulseLoopRef.current.stop();
      pulseAnim.setValue(1);
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current = pulse;
      pulse.start();

      if (ringLoopRef.current) ringLoopRef.current.stop();
      ringPulseAnim.setValue(1);
      ringOpacityAnim.setValue(0.5);
      const ring = Animated.loop(
        Animated.parallel([
          Animated.timing(ringPulseAnim, { toValue: 2.2, duration: 1500, useNativeDriver: true }),
          Animated.timing(ringOpacityAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ])
      );
      ringLoopRef.current = ring;
      ring.start();

      if (Platform.OS !== "web") {
        Vibration.vibrate([0, 800, 400, 800, 400, 800, 400, 800, 400, 800], false);
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

  function stopAllAnimations() {
    if (Platform.OS !== "web") Vibration.cancel();
    if (pulseLoopRef.current) pulseLoopRef.current.stop();
    if (ringLoopRef.current) ringLoopRef.current.stop();
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  function animateOut(forKey: string) {
    stopAllAnimations();
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.9, duration: 200, useNativeDriver: true }),
    ]).start(() => {
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
    stopAllAnimations();
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
  const initials = (displayedCall.callerName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity: fadeAnim,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 30,
        },
      ]}
    >
      <Animated.View style={[styles.content, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.callerSection}>
          <View style={styles.avatarContainer}>
            <Animated.View
              style={[
                styles.ringPulse,
                {
                  transform: [{ scale: ringPulseAnim }],
                  opacity: ringOpacityAnim,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.avatar,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <Text style={styles.avatarText}>{initials}</Text>
            </Animated.View>
          </View>

          <Text style={styles.callerName} numberOfLines={1}>
            {displayedCall.callerName}
          </Text>
          <View style={styles.callTypeRow}>
            <Feather
              name={isVoice ? "phone-incoming" : "video"}
              size={16}
              color="rgba(255,255,255,0.7)"
            />
            <Text style={styles.callTypeText}>
              Incoming {isVoice ? "voice" : "video"} call
            </Text>
          </View>
        </View>

        <View style={styles.actionsSection}>
          <View style={styles.actionCol}>
            <Pressable
              style={[styles.actionBtn, styles.declineBtn]}
              onPress={handleDecline}
              accessibilityRole="button"
              accessibilityLabel="Decline call"
            >
              <Feather name="phone-off" size={28} color="#fff" />
            </Pressable>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>

          <View style={styles.actionCol}>
            <Pressable
              style={[styles.actionBtn, styles.acceptBtn]}
              onPress={handleAccept}
              accessibilityRole="button"
              accessibilityLabel={`Accept ${isVoice ? "voice" : "video"} call`}
            >
              <Feather name={isVoice ? "phone" : "video"} size={28} color="#fff" />
            </Pressable>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: "rgba(6, 14, 22, 0.98)",
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    alignItems: "center",
  },
  callerSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  avatarContainer: {
    width: 140,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  ringPulse: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: "#4AAEC8",
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#4AAEC8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4AAEC8",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
  },
  avatarText: {
    fontSize: 44,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  callerName: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  callTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  callTypeText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)",
  },
  actionsSection: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: SCREEN_W * 0.25,
    paddingBottom: 20,
  },
  actionCol: {
    alignItems: "center",
    gap: 10,
  },
  actionBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  declineBtn: {
    backgroundColor: "#FF3B30",
    shadowColor: "#FF3B30",
  },
  acceptBtn: {
    backgroundColor: "#34C759",
    shadowColor: "#34C759",
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.7)",
  },
});
