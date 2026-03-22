import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,

} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
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
  const [participants, setParticipants] = useState<{ ringing: string[]; offline: string[]; dnd: string[] }>({ ringing: [], offline: [], dnd: [] });
  const callAnsweredRef = React.useRef(false);
  const callStartTimeRef = React.useRef<number | null>(null);

  useEffect(() => {
    joinCall();
    if (Platform.OS === "web") {
      const handler = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "endCall") leaveCall();
        } catch {}
      };
      window.addEventListener("message", handler);
      return () => window.removeEventListener("message", handler);
    }
    return () => InCallManager.stop();
  }, []);

  async function joinCall() {
    setLoading(true);
    setError(null);
    try {
      const data = await post<{ appId: string; channel: string; token: string; uid: number; participants?: { ringing: string[]; offline: string[]; dnd: string[] } }>(
        `/sessions/${sessionId}/video-call`,
        { mode: isVoice ? "voice" : "video" }
      );
      if (data.participants) {
        setParticipants(data.participants);
      }
      const params = new URLSearchParams({
        appId: data.appId,
        channel: data.channel,
        token: data.token,
        uid: String(data.uid),
        ringing: (data.participants?.ringing || []).join(","),
        offline: (data.participants?.offline || []).join(","),
        dnd: (data.participants?.dnd || []).join(","),
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
      } else if (msg.type === "participantJoined") {
        if (!callAnsweredRef.current) {
          callAnsweredRef.current = true;
          callStartTimeRef.current = Date.now();
        }
      }
    } catch {}
  }

  function leaveCall() {
    if (Platform.OS !== "web") {
      InCallManager.stop();
    }
    const answered = callAnsweredRef.current;
    const duration = answered && callStartTimeRef.current
      ? Math.round((Date.now() - callStartTimeRef.current) / 1000)
      : 0;
    post(`/sessions/${sessionId}/call-log`, {
      mode: isVoice ? "voice" : "video",
      status: answered ? "answered" : "missed",
      duration,
    }).catch(() => {});
    router.replace(`/session/${sessionId}` as any);
  }


  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: "#111", paddingTop: insets.top }]}>
        <ActivityIndicator color="#FF6B9D" size="large" />
        <Text style={styles.loadingText}>Connecting…</Text>
        {participants.ringing.length > 0 && (
          <View style={styles.participantStatusRow}>
            <View style={[styles.statusIndicator, { backgroundColor: "#4CAF50" }]} />
            <Text style={styles.participantStatusText}>
              Ringing: {participants.ringing.join(", ")}
            </Text>
          </View>
        )}
        {participants.offline.length > 0 && (
          <View style={styles.participantStatusRow}>
            <View style={[styles.statusIndicator, { backgroundColor: "#94A3B8" }]} />
            <Text style={styles.participantStatusText}>
              Offline: {participants.offline.join(", ")}
            </Text>
          </View>
        )}
        {participants.dnd.length > 0 && (
          <View style={styles.participantStatusRow}>
            <View style={[styles.statusIndicator, { backgroundColor: "#FF9800" }]} />
            <Text style={styles.participantStatusText}>
              Do Not Disturb: {participants.dnd.join(", ")}
            </Text>
          </View>
        )}
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
  participantStatusRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 24,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  participantStatusText: {
    fontSize: 13,
    color: "#ccc",
    fontFamily: "Inter_400Regular",
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
  webview: {
    flex: 1,
    backgroundColor: "#111",
  },
});
