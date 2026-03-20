import React, { useEffect, useState, useRef } from "react";
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

export default function VideoCallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { post } = useApi();
  const webviewRef = useRef<WebView>(null);

  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callUrl, setCallUrl] = useState<string | null>(null);

  useEffect(() => {
    joinCall();
  }, []);

  async function joinCall() {
    setLoading(true);
    setError(null);
    try {
      const data = await post<{ roomUrl: string; token: string }>(`/sessions/${sessionId}/video-call`, {});
      setRoomUrl(data.roomUrl);
      setToken(data.token);
      setCallUrl(`${data.roomUrl}?t=${data.token}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to join call");
    } finally {
      setLoading(false);
    }
  }

  function handleEnd() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Leave call?", "You will exit the video call.", [
      { text: "Stay", style: "cancel" },
      {
        text: "Leave", style: "destructive", onPress: () => {
          router.back();
        }
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: "#000", paddingTop: insets.top }]}>
        <ActivityIndicator color="#fff" size="large" />
        <Text style={[styles.loadingText, { color: "#fff" }]}>Connecting…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: "#000", paddingTop: insets.top }]}>
        <Feather name="video-off" size={48} color="#FF6B6B" />
        <Text style={[styles.errorText, { color: "#fff" }]}>{error}</Text>
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
          <Text style={styles.liveText}>LIVE</Text>
        </View>
        <Pressable style={styles.endBtn} onPress={handleEnd}>
          <Feather name="phone-off" size={18} color="#fff" />
          <Text style={styles.endBtnText}>End</Text>
        </Pressable>
      </View>

      {Platform.OS === "web" ? (
        <View style={styles.webFallback}>
          <Feather name="video" size={48} color="#FF6B9D" />
          <Text style={{ color: "#fff", fontSize: 16, marginTop: 16, textAlign: "center", paddingHorizontal: 32 }}>
            Video calls open in your browser on web. Tap below to join.
          </Text>
          <Pressable
            style={styles.openBrowserBtn}
            onPress={() => {
              if (typeof window !== "undefined") window.open(callUrl, "_blank");
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 16 }}>Open Call</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={webviewRef}
          source={{ uri: callUrl }}
          style={styles.webview}
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
    backgroundColor: "#000",
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
  },
  errorText: {
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 32,
    fontFamily: "Inter_400Regular",
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
    backgroundColor: "rgba(0,0,0,0.7)",
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
    backgroundColor: "#FF3B30",
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
    backgroundColor: "#000",
  },
  webFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  openBrowserBtn: {
    marginTop: 24,
    backgroundColor: "#FF6B9D",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
});
