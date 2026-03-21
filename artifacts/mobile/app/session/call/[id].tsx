import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import InCallManager from "react-native-incall-manager";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export default function CallScreen() {
  const { id, mode = "video" } = useLocalSearchParams<{ id: string; mode?: string }>();
  const sessionId = parseInt(id, 10);
  const isVoice = mode === "voice";
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { post } = useApi();

  const [callUrl, setCallUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [speakerOn, setSpeakerOn] = useState(!isVoice);

  useEffect(() => {
    joinCall();
    return () => {
      if (Platform.OS !== "web") {
        InCallManager.stop();
      }
    };
  }, []);

  async function joinCall() {
    setLoading(true);
    setError(null);
    try {
      const data = await post<{ appId: string; channel: string; token: string; uid: number }>(
        `/sessions/${sessionId}/video-call`,
        { mode: isVoice ? "voice" : "video" }
      );
      const params = new URLSearchParams({
        appId: data.appId,
        channel: data.channel,
        token: data.token,
        uid: String(data.uid),
      });
      const pageUrl = `${BASE_URL}/api/sessions/${sessionId}/call-page?mode=${isVoice ? "voice" : "video"}&${params.toString()}`;
      setCallUrl(pageUrl);

      if (Platform.OS !== "web") {
        InCallManager.start({ media: isVoice ? "audio" : "video", auto: true });
        InCallManager.setSpeakerphoneOn(!isVoice);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to join call");
    } finally {
      setLoading(false);
    }
  }

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "endCall") {
        leaveCall();
      } else if (msg.type === "toggleSpeaker") {
        const next = !speakerOn;
        setSpeakerOn(next);
        if (Platform.OS !== "web") {
          InCallManager.setSpeakerphoneOn(next);
        }
      }
    } catch {}
  }

  function leaveCall() {
    if (Platform.OS !== "web") {
      InCallManager.stop();
    }
    router.replace(`/session/${sessionId}` as any);
  }

  function handleEnd() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === "web") {
      if (window.confirm(`Leave ${isVoice ? "voice" : "video"} call?`)) {
        leaveCall();
      }
    } else {
      Alert.alert(`Leave ${isVoice ? "voice" : "video"} call?`, "You will exit the call.", [
        { text: "Stay", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: leaveCall },
      ]);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: "#111", paddingTop: insets.top }]}>
        <ActivityIndicator color="#FF6B9D" size="large" />
        <Text style={styles.loadingText}>Connecting…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: "#111", paddingTop: insets.top }]}>
        <Feather name={isVoice ? "phone-off" : "video-off"} size={48} color="#FF6B6B" />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={joinCall}>
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Retry</Text>
        </Pressable>
        <Pressable style={[styles.retryBtn, { backgroundColor: "#333", marginTop: 8 }]} onPress={() => router.back()}>
          <Text style={{ color: "#fff", fontFamily: "Inter_400Regular" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!callUrl) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <View style={styles.callBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>{isVoice ? "VOICE" : "VIDEO"}</Text>
        </View>
        <Pressable style={styles.endBtn} onPress={handleEnd}>
          <Feather name="phone-off" size={18} color="#fff" />
          <Text style={styles.endBtnText}>End</Text>
        </Pressable>
      </View>

      {Platform.OS === "web" ? (
        <iframe
          src={callUrl}
          style={{ flex: 1, border: "none", width: "100%", height: "100%" } as any}
          allow="camera; microphone; display-capture; autoplay"
          allowFullScreen
        />
      ) : (
        <WebView
          source={{ uri: callUrl }}
          style={styles.webview}
          onMessage={handleMessage}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          mediaCapturePermissionGrantType="grant"
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
          originWhitelist={["*"]}
          onError={(e) => setError(e.nativeEvent.description)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    marginTop: 12,
    fontFamily: "Inter_400Regular",
    color: "#fff",
  },
  errorText: {
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 32,
    fontFamily: "Inter_400Regular",
    color: "#fff",
  },
  retryBtn: {
    backgroundColor: "#FF6B9D",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  callBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#4CAF50",
  },
  liveText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FF3B30",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  endBtnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  webview: {
    flex: 1,
    backgroundColor: "#111",
  },
});
