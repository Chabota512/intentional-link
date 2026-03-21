import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  ScrollView,
  Share,
  Image,
  Linking,
  Keyboard,
  Dimensions,
  PanResponder,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeIn, FadeOut, useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import * as SMS from "expo-sms";
import * as ExpoLinking from "expo-linking";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";
import { Audio, Video, ResizeMode, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { VideoView, useVideoPlayer } from "expo-video";
import { LightSensor } from "expo-sensors";
import { useTheme } from "@/hooks/useTheme";
import { useApi, ApiError } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { useLocalDiscovery } from "@/context/LocalDiscoveryContext";
import { useSocket } from "@/context/SocketContext";
import { confirmAction } from "@/utils/confirm";
import { formatTime, formatRelative } from "@/utils/date";
import { isOnline, formatLastSeen } from "@/utils/lastSeen";
import UserAvatar from "@/components/UserAvatar";

interface User {
  id: number;
  name: string;
  username: string;
  avatarUrl?: string | null;
  lastSeenAt?: string | null;
}

interface Reaction {
  emoji: string;
  count: number;
  userIds: number[];
  reactors?: { id: number; name: string }[];
}

interface ReplyTo {
  id: number;
  content: string;
  senderId: number;
  senderName: string;
  type: string;
}

interface Message {
  id: number;
  sessionId: number;
  senderId: number;
  content: string;
  type: "text" | "image" | "file" | "voice";
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  replyToId?: number | null;
  replyTo?: ReplyTo | null;
  status: string;
  createdAt: string;
  sender: User;
  reactions?: Reaction[];
}

interface Participant {
  id: number;
  userId: number;
  status: string;
  user: User;
}

interface Session {
  id: number;
  title: string;
  description?: string;
  imageUrl?: string | null;
  creatorId: number;
  creator?: { id: number; name: string; username: string; avatarUrl?: string | null; lastSeenAt?: string | null } | null;
  status: "active" | "completed";
  participants: Participant[];
  createdAt: string;
  endedAt?: string;
}

interface Contact {
  id: number;
  userId: number;
  contactUser: User;
  createdAt: string;
}

interface SessionPreview {
  id: number;
  title: string;
  status: "active" | "completed";
  participantCount: number;
  creatorName: string;
  createdAt: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function VoicePlayer({
  url,
  colors,
  senderName,
  senderAvatarUrl,
  isOwn,
  onPlayed,
  durationHint,
  onLongPress,
}: {
  url: string;
  colors: any;
  senderName?: string;
  senderAvatarUrl?: string | null;
  isOwn?: boolean;
  onPlayed?: () => void;
  durationHint?: number;
  onLongPress?: () => void;
}) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [useEarpiece, setUseEarpiece] = useState(false);
  const lightSubRef = useRef<{ remove: () => void } | null>(null);
  const positionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyAudioMode = async (earpiece: boolean) => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: earpiece,
      playsInSilentModeIOS: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: earpiece,
    });
  };

  const resetAudioMode = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: false,
        staysActiveInBackground: false,
        interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
        shouldDuckAndroid: false,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        playThroughEarpieceAndroid: false,
      });
    } catch {}
  };

  const startLightSensor = () => {
    if (Platform.OS !== "android") return;
    LightSensor.isAvailableAsync().then((available) => {
      if (!available) return;
      LightSensor.setUpdateInterval(300);
      lightSubRef.current = LightSensor.addListener(({ illuminance }) => {
        const nearEar = illuminance < 5;
        setUseEarpiece((prev) => {
          if (prev !== nearEar) {
            applyAudioMode(nearEar);
          }
          return nearEar;
        });
      });
    });
  };

  const stopLightSensor = () => {
    lightSubRef.current?.remove();
    lightSubRef.current = null;
  };

  const toggleEarpiece = async () => {
    const next = !useEarpiece;
    setUseEarpiece(next);
    await applyAudioMode(next);
  };

  const togglePlayWeb = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (!htmlAudioRef.current) {
        const audio = new (window as any).Audio() as HTMLAudioElement;
        audio.preload = "auto";
        audio.src = url;
        htmlAudioRef.current = audio;
        audio.ontimeupdate = () => {
          setPosition(audio.currentTime * 1000);
        };
        audio.onloadedmetadata = () => {
          if (isFinite(audio.duration)) {
            setDuration(audio.duration * 1000);
          }
        };
        audio.onended = () => {
          setPlaying(false);
          setPosition(0);
          if (!hasPlayed) {
            setHasPlayed(true);
            onPlayed?.();
          }
        };
        audio.onerror = () => {
          setPlaying(false);
          setLoading(false);
          Alert.alert("Error", "Could not load voice note.");
        };
      }
      const audio = htmlAudioRef.current!;
      if (playing) {
        audio.pause();
        setPlaying(false);
        setLoading(false);
      } else {
        try {
          await audio.play();
          setPlaying(true);
          if (!hasPlayed) {
            setHasPlayed(true);
            onPlayed?.();
          }
        } catch {
          Alert.alert("Error", "Could not play voice note.");
        }
        setLoading(false);
      }
    } catch {
      Alert.alert("Error", "Could not play voice note.");
      setLoading(false);
    }
  };

  const togglePlayNative = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        stopLightSensor();
        resetAudioMode();
      } else {
        await applyAudioMode(useEarpiece);
        if (!soundRef.current) {
          const { sound } = await Audio.Sound.createAsync(
            { uri: url },
            { shouldPlay: false },
          );
          soundRef.current = sound;
          sound.setOnPlaybackStatusUpdate((status: any) => {
            if (status.isLoaded) {
              setPosition(status.positionMillis ?? 0);
              setDuration(status.durationMillis ?? 0);
            }
            if (status.didJustFinish) {
              setPlaying(false);
              setPosition(0);
              stopLightSensor();
              resetAudioMode();
            }
          });
        }
        await soundRef.current.playAsync();
        setPlaying(true);
        startLightSensor();
        if (!hasPlayed) {
          setHasPlayed(true);
          onPlayed?.();
        }
      }
    } catch {
      Alert.alert("Error", "Could not play voice note.");
    }
    setLoading(false);
  };

  const togglePlay = Platform.OS === "web" ? togglePlayWeb : togglePlayNative;

  useEffect(() => {
    return () => {
      if (htmlAudioRef.current) {
        htmlAudioRef.current.pause();
        htmlAudioRef.current.src = "";
        htmlAudioRef.current = null;
      }
      soundRef.current?.unloadAsync();
      stopLightSensor();
      if (positionIntervalRef.current) clearInterval(positionIntervalRef.current);
      resetAudioMode();
    };
  }, []);

  const formatDur = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
  const timeLabel = duration > 0
    ? `${formatDur(position)} / ${formatDur(duration)}`
    : durationHint && durationHint > 0
    ? formatDur(durationHint * 1000)
    : "--:--";

  return (
    <View style={[styles.voicePlayerRow]}>
      {!isOwn && senderName && (
        <UserAvatar name={senderName} avatarUrl={senderAvatarUrl} size={28} showDot={false} />
      )}
      <Pressable
        onPress={togglePlay}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[styles.voicePlayer, { backgroundColor: isOwn ? "rgba(255,255,255,0.18)" : colors.surfaceAlt }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={isOwn ? "#fff" : colors.accent} />
        ) : (
          <View style={[styles.voicePlayBtn, { backgroundColor: isOwn ? "rgba(255,255,255,0.25)" : colors.accentSoft }]}>
            <Feather name={playing ? "pause" : "play"} size={14} color={isOwn ? "#fff" : colors.accent} />
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          {/* Waveform bars — filled up to current playback position */}
          <View style={styles.voiceWaveform}>
            {[4, 8, 12, 6, 10, 14, 8, 5, 11, 7, 13, 9, 6, 10, 7].map((h, i, arr) => {
              const barProgress = (i + 1) / arr.length;
              const played = barProgress <= progress;
              return (
                <View
                  key={i}
                  style={{
                    width: 2.5,
                    height: h,
                    borderRadius: 2,
                    backgroundColor: isOwn
                      ? played ? "#fff" : "rgba(255,255,255,0.3)"
                      : played ? colors.accent : colors.border,
                  }}
                />
              );
            })}
          </View>
          <Text style={[styles.voiceLabel, { color: isOwn ? "rgba(255,255,255,0.8)" : colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            {timeLabel}
          </Text>
        </View>
        {Platform.OS !== "web" && (
          <Pressable
            onPress={(e) => { e.stopPropagation(); toggleEarpiece(); }}
            hitSlop={8}
            style={{ padding: 4 }}
          >
            <Feather
              name={useEarpiece ? "phone" : "volume-2"}
              size={13}
              color={isOwn ? "rgba(255,255,255,0.7)" : colors.textTertiary}
            />
          </Pressable>
        )}
      </Pressable>
      {isOwn && senderName && (
        <UserAvatar name={senderName} avatarUrl={senderAvatarUrl} size={28} showDot={false} />
      )}
    </View>
  );
}

const ALL_REACTION_EMOJIS = [
  "❤️", "😂", "😮", "😢", "🙏", "👍",
  "😍", "🥺", "😭", "🤣", "😊", "🥳",
  "🤔", "😬", "🤯", "🤗", "😏", "😎",
  "🙃", "😒", "😀", "😤", "😈", "🤌",
  "👎", "🙌", "💪", "👏", "✌️", "👋",
  "🧡", "💛", "💚", "💙", "💜", "🖤",
  "💔", "💯", "🔥", "✨", "⭐", "💫",
  "🎉", "🎊", "👀", "💀", "💩", "🫡",
  "🥹", "😅", "🫶", "🤙", "🫠", "🤓",
];

const EMOJI_USAGE_KEY = "focus_emoji_usage_v1";

type EmojiUsage = Record<string, { count: number; lastUsed: number }>;

function getSortedEmojis(usage: EmojiUsage): string[] {
  return [...ALL_REACTION_EMOJIS].sort((a, b) => {
    const ua = usage[a];
    const ub = usage[b];
    if (!ua && !ub) return 0;
    if (!ua) return 1;
    if (!ub) return -1;
    if (ub.count !== ua.count) return ub.count - ua.count;
    return ub.lastUsed - ua.lastUsed;
  });
}

function isVideoFile(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\.(mp4|mov|m4v|avi|mkv|webm|3gp|wmv)$/i.test(name);
}

const THUMB_W = 220;
const THUMB_H = 140;

function VideoThumbnailCard({ url, name, isOwn, colors, onPress, onLongPress }: {
  url: string;
  name: string;
  isOwn: boolean;
  colors: ReturnType<typeof import("@/hooks/useTheme").useTheme>["colors"];
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => ({
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "#000",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Video
        source={{ uri: url }}
        style={{ width: THUMB_W, height: THUMB_H }}
        resizeMode={ResizeMode.COVER}
        shouldPlay={false}
        isMuted
        positionMillis={800}
      />
      <View style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.2)",
      }}>
        <View style={{
          width: 46, height: 46, borderRadius: 23,
          backgroundColor: "rgba(0,0,0,0.65)",
          alignItems: "center", justifyContent: "center",
        }}>
          <Feather name="play" size={22} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      </View>
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        paddingHorizontal: 10, paddingVertical: 5,
      }}>
        <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{name}</Text>
      </View>
    </Pressable>
  );
}

function MessageBubble({ message, isOwn, showSender, showAvatar, currentUser, colors, getFileUrl, onPlayed, onLongPress, onReact, onReactionPress, senderPresenceStatus, onAvatarPress, onImagePress, onVideoPress }: {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  showAvatar: boolean;
  currentUser: User | null;
  colors: ReturnType<typeof import("@/hooks/useTheme").useTheme>["colors"];
  getFileUrl: (path: string) => string;
  onPlayed?: () => void;
  onLongPress?: () => void;
  onReact?: (emoji: string) => void;
  onReactionPress?: (reaction: Reaction, isMine: boolean) => void;
  senderPresenceStatus?: "online" | "offline" | "local";
  onAvatarPress?: (user: { name: string; username?: string; avatarUrl?: string | null; presenceStatus?: "online" | "offline" | "local" }) => void;
  onImagePress?: (url: string) => void;
  onVideoPress?: (url: string, name: string) => void;
}) {
  const renderContent = () => {
    if (message.type === "image" && message.attachmentUrl) {
      const url = getFileUrl(message.attachmentUrl);
      return (
        <Pressable
          onPress={() => onImagePress ? onImagePress(url) : Linking.openURL(url)}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress?.(); }}
          delayLongPress={350}
        >
          <Image
            source={{ uri: url }}
            style={styles.imageBubble}
            resizeMode="cover"
          />
          {message.content ? (
            <Text style={[styles.bubbleText, { color: isOwn ? "#fff" : colors.text, fontFamily: "Inter_400Regular", marginTop: 4 }]}>
              {message.content}
            </Text>
          ) : null}
        </Pressable>
      );
    }

    if (message.type === "file" && message.attachmentUrl) {
      const url = getFileUrl(message.attachmentUrl);

      if (isVideoFile(message.attachmentName)) {
        return (
          <VideoThumbnailCard
            url={url}
            name={message.attachmentName || "Video"}
            isOwn={isOwn}
            colors={colors}
            onPress={() => onVideoPress?.(url, message.attachmentName || "Video")}
            onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress?.(); }}
          />
        );
      }

      return (
        <Pressable
          onPress={() => Linking.openURL(url)}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress?.(); }}
          delayLongPress={350}
          style={styles.fileCard}
        >
          <View style={[styles.fileIcon, { backgroundColor: isOwn ? "rgba(255,255,255,0.2)" : colors.accentSoft }]}>
            <Feather name="file" size={18} color={isOwn ? "#fff" : colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.fileName, { color: isOwn ? "#fff" : colors.text, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
              {message.attachmentName || "File"}
            </Text>
            {message.attachmentSize ? (
              <Text style={[styles.fileSize, { color: isOwn ? "rgba(255,255,255,0.7)" : colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                {formatFileSize(message.attachmentSize)}
              </Text>
            ) : null}
          </View>
          <Feather name="download" size={16} color={isOwn ? "rgba(255,255,255,0.8)" : colors.accent} />
        </Pressable>
      );
    }

    if (message.type === "voice" && message.attachmentUrl) {
      const url = getFileUrl(message.attachmentUrl);
      const durationHint = message.content ? parseInt(message.content, 10) : 0;
      return (
        <VoicePlayer
          url={url}
          colors={colors}
          senderName={isOwn ? currentUser?.name : message.sender.name}
          senderAvatarUrl={isOwn ? currentUser?.avatarUrl : message.sender.avatarUrl}
          isOwn={isOwn}
          onPlayed={!isOwn ? onPlayed : undefined}
          durationHint={isNaN(durationHint) ? 0 : durationHint}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress?.(); }}
        />
      );
    }

    if (message.type === "call") {
      let callData: { mode?: string; status?: string; duration?: number } = {};
      try { callData = JSON.parse(message.content); } catch {}
      const isVoiceCall = callData.mode === "voice";
      const missed = callData.status === "missed";
      const dur = callData.duration ?? 0;
      const formatCallDur = (s: number) =>
        s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
      const iconName = isVoiceCall ? "phone" : "video";
      const callColor = missed ? colors.danger : (isOwn ? "rgba(255,255,255,0.9)" : colors.text);
      return (
        <View style={styles.callRow}>
          <Feather name={missed ? "phone-missed" : iconName} size={14} color={missed ? colors.danger : (isOwn ? "rgba(255,255,255,0.8)" : colors.accent)} />
          <View>
            <Text style={[styles.callLabel, { color: callColor, fontFamily: "Inter_500Medium" }]}>
              {missed ? "Missed " : ""}{isVoiceCall ? "Voice" : "Video"} call
            </Text>
            {!missed && dur > 0 && (
              <Text style={[styles.callDuration, { color: isOwn ? "rgba(255,255,255,0.6)" : colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                {formatCallDur(dur)}
              </Text>
            )}
          </View>
        </View>
      );
    }

    return (
      <Text style={[styles.bubbleText, { color: isOwn ? "#fff" : colors.text, fontFamily: "Inter_400Regular" }]}>
        {message.content}
      </Text>
    );
  };

  const avatarPlaceholder = <View style={{ width: 30 }} />;
  const reactions = message.reactions ?? [];
  const currentUserId = currentUser?.id;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      style={[
        styles.bubbleRow,
        isOwn ? styles.bubbleRowRight : styles.bubbleRowLeft,
      ]}
    >
      {!isOwn && (
        showAvatar
          ? (
            <Pressable
              onPress={() => onAvatarPress?.({
                name: message.sender.name,
                username: message.sender.username,
                avatarUrl: message.sender.avatarUrl,
                presenceStatus: senderPresenceStatus,
              })}
              hitSlop={8}
            >
              <UserAvatar name={message.sender.name} avatarUrl={message.sender.avatarUrl} size={30} style={styles.senderAvatar} presenceStatus={senderPresenceStatus} />
            </Pressable>
          )
          : avatarPlaceholder
      )}
      <View style={{ maxWidth: "75%", gap: 3 }}>
        {showSender && !isOwn && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <Text style={[styles.senderName, { color: colors.textSecondary }]}>
              {message.sender.name}
            </Text>
            {isOnline(message.sender.lastSeenAt) && (
              <View style={[styles.onlineDotSmall, { backgroundColor: colors.success }]} />
            )}
          </View>
        )}
        <Pressable
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress?.(); }}
          delayLongPress={350}
        >
          <View
            style={[
              styles.bubble,
              message.type === "image" ? styles.bubbleImage : null,
              isOwn
                ? [styles.bubbleOwn, { backgroundColor: colors.messageBubbleOwn }]
                : [styles.bubbleOther, { backgroundColor: colors.messageBubbleOther, borderColor: colors.border }],
            ]}
          >
            {message.replyTo && (
              <View style={[styles.replyQuote, { backgroundColor: isOwn ? "rgba(255,255,255,0.15)" : colors.surfaceAlt, borderLeftColor: colors.accent }]}>
                <Text style={[styles.replyQuoteName, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                  {message.replyTo.senderName}
                </Text>
                <Text style={[styles.replyQuoteText, { color: isOwn ? "rgba(255,255,255,0.8)" : colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                  {message.replyTo.type !== "text" ? `[${message.replyTo.type}]` : message.replyTo.content}
                </Text>
              </View>
            )}
            {renderContent()}
          </View>
        </Pressable>
        {reactions.length > 0 && (
          <View style={[styles.reactionsRow, { alignSelf: isOwn ? "flex-end" : "flex-start" }]}>
            {reactions.map((r) => {
              const isMine = currentUserId != null && r.userIds.includes(currentUserId);
              return (
                <Pressable
                  key={r.emoji}
                  onPress={() => onReactionPress ? onReactionPress(r, isMine) : onReact?.(r.emoji)}
                  style={({ pressed }) => [
                    styles.reactionPill,
                    {
                      backgroundColor: isMine ? colors.accentSoft : colors.surfaceAlt,
                      borderColor: isMine ? colors.accent : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  <Text style={[styles.reactionCount, { color: isMine ? colors.accent : colors.textSecondary }]}>
                    {r.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <View style={[styles.bubbleMeta, { alignSelf: isOwn ? "flex-end" : "flex-start" }]}>
          <Text style={[styles.bubbleTime, { color: colors.textTertiary }]}>
            {formatTime(message.createdAt)}
          </Text>
          {isOwn && message.status === "read" ? (
            <View style={{ flexDirection: "row" }}>
              <Feather name="check" size={10} color="#2196F3" style={{ marginRight: -4 }} />
              <Feather name="check" size={10} color="#2196F3" />
            </View>
          ) : isOwn && message.status === "delivered" ? (
            <View style={{ flexDirection: "row" }}>
              <Feather name="check" size={10} color={colors.textTertiary} style={{ marginRight: -4 }} />
              <Feather name="check" size={10} color={colors.textTertiary} />
            </View>
          ) : isOwn ? (
            <Feather name="check" size={10} color={colors.textTertiary} />
          ) : null}
        </View>
      </View>
      {isOwn && (
        showAvatar
          ? (
            <Pressable
              onPress={() => onAvatarPress?.({
                name: currentUser?.name ?? "?",
                username: currentUser?.username,
                avatarUrl: currentUser?.avatarUrl,
                presenceStatus: "online",
              })}
              hitSlop={8}
            >
              <UserAvatar name={currentUser?.name ?? "?"} avatarUrl={currentUser?.avatarUrl} size={30} style={styles.senderAvatar} presenceStatus="online" />
            </Pressable>
          )
          : avatarPlaceholder
      )}
    </Animated.View>
  );
}

type SheetView = "participants" | "invite";
type AttachMenuOption = "image" | "file" | "voice" | null;

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, post, patch, del, uploadFile, getFileUrl } = useApi();
  const { user } = useAuth();
  const { getPresenceStatus } = useLocalDiscovery();
  const { isConnected: socketConnected, typingUsers, recordingUsers, onlineUserIds, emitTypingStart, emitTypingStop, emitRecordingStart, emitRecordingStop, emitMarkRead, joinSession, leaveSession } = useSocket();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const lastMsgId = useRef(0);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("participants");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reactionPickerMessage, setReactionPickerMessage] = useState<Message | null>(null);
  const [reactorsModal, setReactorsModal] = useState<{ reaction: Reaction; messageId: number } | null>(null);
  const [customEmojiInput, setCustomEmojiInput] = useState("");
  const [showCustomEmoji, setShowCustomEmoji] = useState(false);
  const [reactionKeyboardHeight, setReactionKeyboardHeight] = useState(0);
  const [emojiUsage, setEmojiUsage] = useState<EmojiUsage>({});
  const [actionMenuMessage, setActionMenuMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [profileViewUser, setProfileViewUser] = useState<{ name: string; username?: string; avatarUrl?: string | null; presenceStatus?: "online" | "offline" | "local" } | null>(null);
  const [viewerImageIndex, setViewerImageIndex] = useState<number | null>(null);
  const [videoViewer, setVideoViewer] = useState<{ url: string; name: string } | null>(null);
  const inAppVideoPlayer = useVideoPlayer(null, (p) => { p.loop = false; });
  const vpAutoPlayRef = useRef(false);

  useEffect(() => {
    if (videoViewer?.url) {
      vpAutoPlayRef.current = true;
      inAppVideoPlayer.replace({ uri: videoViewer.url });
      setVpRate(1);
      setVpMuted(false);
      setVpLooping(false);
      setVpCurrentTime(0);
    } else {
      vpAutoPlayRef.current = false;
      inAppVideoPlayer.pause();
    }
  }, [videoViewer?.url]);

  const [vpIsPlaying, setVpIsPlaying] = useState(false);
  const [vpCurrentTime, setVpCurrentTime] = useState(0);
  const [vpStatus, setVpStatus] = useState<"idle" | "loading" | "readyToPlay" | "error">("idle");

  useEffect(() => {
    inAppVideoPlayer.timeUpdateEventInterval = 0.5;
    const s1 = inAppVideoPlayer.addListener("playingChange", ({ isPlaying }) => setVpIsPlaying(isPlaying));
    const s2 = inAppVideoPlayer.addListener("timeUpdate", ({ currentTime }) => setVpCurrentTime(currentTime));
    const s3 = inAppVideoPlayer.addListener("statusChange", ({ status }) => {
      setVpStatus(status);
      if (status === "readyToPlay" && vpAutoPlayRef.current) {
        vpAutoPlayRef.current = false;
        inAppVideoPlayer.play();
      }
    });
    return () => { s1.remove(); s2.remove(); s3.remove(); };
  }, []);

  const [vpRate, setVpRate] = useState(1);
  const [vpMuted, setVpMuted] = useState(false);
  const [vpLooping, setVpLooping] = useState(false);
  const [vpSpeedOpen, setVpSpeedOpen] = useState(false);
  const [vpBarWidth, setVpBarWidth] = useState(1);
  const [vpControlsVisible, setVpControlsVisible] = useState(true);
  const vpControlsOpacity = useSharedValue(1);
  const vpHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vpAnimStyle = useAnimatedStyle(() => ({ opacity: vpControlsOpacity.value }));
  const vpDuration = (vpStatus === "readyToPlay" ? inAppVideoPlayer.duration : 0) || 0;

  const vpFormatTime = (s: number) => {
    const clamped = Math.max(0, s);
    const m = Math.floor(clamped / 60);
    const sec = Math.floor(clamped % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const vpShowControls = () => {
    if (vpHideTimer.current) clearTimeout(vpHideTimer.current);
    setVpControlsVisible(true);
    vpControlsOpacity.value = withTiming(1, { duration: 180 });
    vpHideTimer.current = setTimeout(() => {
      vpControlsOpacity.value = withTiming(0, { duration: 350 });
      setVpControlsVisible(false);
    }, 3500);
  };

  const vpTogglePlay = () => {
    if (vpIsPlaying) inAppVideoPlayer.pause();
    else inAppVideoPlayer.play();
    vpShowControls();
  };

  const vpSetRate = (rate: number) => {
    inAppVideoPlayer.playbackRate = rate;
    setVpRate(rate);
    setVpSpeedOpen(false);
    vpShowControls();
  };

  const vpToggleMute = () => {
    const next = !vpMuted;
    inAppVideoPlayer.muted = next;
    setVpMuted(next);
    vpShowControls();
  };

  const vpToggleLoop = () => {
    const next = !vpLooping;
    inAppVideoPlayer.loop = next;
    setVpLooping(next);
    vpShowControls();
  };

  const [vpDownloading, setVpDownloading] = useState(false);
  const lastTapLeftRef = useRef(0);
  const lastTapRightRef = useRef(0);

  const vpHideControls = () => {
    if (vpHideTimer.current) clearTimeout(vpHideTimer.current);
    vpControlsOpacity.value = withTiming(0, { duration: 250 });
    setVpControlsVisible(false);
  };

  const handleTapLeft = () => {
    const now = Date.now();
    if (now - lastTapLeftRef.current < 300) {
      lastTapLeftRef.current = 0;
      inAppVideoPlayer.seekBy(-5);
      vpShowControls();
    } else {
      lastTapLeftRef.current = now;
      if (vpControlsVisible) vpHideControls();
      else vpShowControls();
    }
  };

  const handleTapRight = () => {
    const now = Date.now();
    if (now - lastTapRightRef.current < 300) {
      lastTapRightRef.current = 0;
      inAppVideoPlayer.seekBy(5);
      vpShowControls();
    } else {
      lastTapRightRef.current = now;
      if (vpControlsVisible) vpHideControls();
      else vpShowControls();
    }
  };

  const vpDownloadVideo = async () => {
    if (!videoViewer?.url || vpDownloading) return;
    try {
      setVpDownloading(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow access to save videos to your gallery.");
        return;
      }
      const filename = videoViewer.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "video.mp4";
      const localUri = FileSystem.cacheDirectory + filename;
      const { uri } = await FileSystem.downloadAsync(videoViewer.url, localUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert("Saved", "Video saved to your gallery.");
    } catch {
      Alert.alert("Error", "Could not save the video.");
    } finally {
      setVpDownloading(false);
    }
  };

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      if (reactionPickerMessage !== null) setReactionKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setReactionKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, [reactionPickerMessage]);

  useEffect(() => {
    AsyncStorage.getItem(EMOJI_USAGE_KEY).then((raw) => {
      if (raw) {
        try { setEmojiUsage(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  const trackEmojiUsage = useCallback((emoji: string) => {
    setEmojiUsage((prev) => {
      const updated = {
        ...prev,
        [emoji]: {
          count: (prev[emoji]?.count ?? 0) + 1,
          lastUsed: Date.now(),
        },
      };
      AsyncStorage.setItem(EMOJI_USAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [inputHeight, setInputHeight] = useState(21);
  const isLoadingOlderRef = useRef(false);

  const { data: session, isLoading: sessionLoading, error: sessionError } = useQuery<Session>({
    queryKey: ["session", sessionId],
    queryFn: () => get(`/sessions/${sessionId}`),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 403) return false;
      return failureCount < 2;
    },
  });

  const isNotMember = sessionError instanceof ApiError && sessionError.status === 403;

  const { data: sessionPreview, isLoading: previewLoading } = useQuery<SessionPreview>({
    queryKey: ["session-preview", sessionId],
    queryFn: () => get(`/sessions/${sessionId}/preview`),
    enabled: isNotMember,
    retry: false,
  });

  const joinByLinkMutation = useMutation({
    mutationFn: () => post(`/sessions/${sessionId}/join-link`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => {
      Alert.alert("Could not join", e.message || "Unable to join this chat.");
    },
  });

  const shareSessionLink = async () => {
    const link = ExpoLinking.createURL(`session/${sessionId}`);
    const message = `Join my Intentional Link session "${session?.title ?? "Session"}": ${link}`;
    try {
      const smsAvailable = await SMS.isAvailableAsync();
      if (smsAvailable) {
        await SMS.sendSMSAsync([], message);
      } else {
        await Share.share({ message, url: link });
      }
    } catch {
      await Share.share({ message, url: link });
    }
  };

  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ["messages", sessionId],
    queryFn: async () => {
      const data: Message[] = await get(`/sessions/${sessionId}/messages?limit=50`);
      if (data.length > 0) {
        lastMsgId.current = data[data.length - 1].id;
        setHasOlder(data.length === 50);
      }
      return data;
    },
  });

  const chatImageUrls = useMemo(() => {
    return messages
      .filter(m => m.type === "image" && m.attachmentUrl)
      .map(m => getFileUrl(m.attachmentUrl!));
  }, [messages, getFileUrl]);

  const openImageViewer = useCallback((url: string) => {
    const idx = chatImageUrls.indexOf(url);
    setViewerImageIndex(idx >= 0 ? idx : 0);
  }, [chatImageUrls]);

  const viewerPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -40) {
        setViewerImageIndex(prev => prev !== null && prev < chatImageUrls.length - 1 ? prev + 1 : prev);
      } else if (g.dx > 40) {
        setViewerImageIndex(prev => prev !== null && prev > 0 ? prev - 1 : prev);
      }
    },
  }), [chatImageUrls.length]);

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
    enabled: sheetVisible && sheetView === "invite",
  });

  useEffect(() => {
    if (!session || session.status !== "active") return;
    joinSession(sessionId);
    emitMarkRead(sessionId);
    return () => {
      leaveSession(sessionId);
    };
  }, [session, sessionId]);

  useEffect(() => {
    if (!session || session.status !== "active" || socketConnected) return;
    const interval = setInterval(async () => {
      try {
        const newMsgs = await get(`/sessions/${sessionId}/messages/poll?since=${lastMsgId.current}`);
        if (newMsgs.length > 0) {
          lastMsgId.current = newMsgs[newMsgs.length - 1].id;
          queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => {
            const existingIds = new Set(old.map((m) => m.id));
            const fresh = newMsgs.filter((m: Message) => !existingIds.has(m.id));
            return fresh.length > 0 ? [...old, ...fresh] : old;
          });
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [session, sessionId, socketConnected]);

  useEffect(() => {
    if (messages.length > 0 && session?.status === "active") {
      emitMarkRead(sessionId);
    }
  }, [messages.length]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTextChange = (value: string) => {
    setText(value);
    if (value.trim() && session?.status === "active") {
      emitTypingStart(sessionId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        emitTypingStop(sessionId);
      }, 3000);
    } else if (!value.trim()) {
      emitTypingStop(sessionId);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    }
  };

  const sessionTypingUserIds = typingUsers.get(sessionId);
  const typingParticipantNames = session?.participants
    .filter((p) => sessionTypingUserIds?.has(p.userId))
    .map((p) => p.user.name) ?? [];
  if (session?.creator && sessionTypingUserIds?.has(session.creator.id) && session.creator.id !== user?.id) {
    const creatorName = session.creator.name;
    if (!typingParticipantNames.includes(creatorName)) {
      typingParticipantNames.push(creatorName);
    }
  }

  const sessionRecordingUserIds = recordingUsers.get(sessionId);
  const recordingParticipantNames = session?.participants
    .filter((p) => sessionRecordingUserIds?.has(p.userId))
    .map((p) => p.user.name) ?? [];
  if (session?.creator && sessionRecordingUserIds?.has(session.creator.id) && session.creator.id !== user?.id) {
    const creatorName = session.creator.name;
    if (!recordingParticipantNames.includes(creatorName)) {
      recordingParticipantNames.push(creatorName);
    }
  }

  useEffect(() => {
    if (messages.length > 0 && !isLoadingOlderRef.current) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(showEvent, () => {
      if (reactionPickerMessage !== null) return;
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    });
    return () => sub.remove();
  }, [reactionPickerMessage]);

  const sendMutation = useMutation({
    mutationFn: (payload: { content?: string; type?: string; attachmentUrl?: string; attachmentName?: string; attachmentSize?: number; replyToId?: number }) =>
      post(`/sessions/${sessionId}/messages`, payload),
    onMutate: async (payload) => {
      const tempId = -(Date.now());
      const tempMsg: Message = {
        id: tempId,
        sessionId,
        senderId: user!.id,
        content: payload.content || "",
        type: (payload.type as any) || "text",
        attachmentUrl: payload.attachmentUrl || null,
        attachmentName: payload.attachmentName || null,
        attachmentSize: payload.attachmentSize || null,
        status: "sent",
        createdAt: new Date().toISOString(),
        sender: { id: user!.id, name: user!.name, username: user!.username },
      };
      queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => [...old, tempMsg]);
      return { tempId };
    },
    onSuccess: (newMsg, _vars, context) => {
      lastMsgId.current = newMsg.id;
      const tempId = context?.tempId;
      queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => {
        return old.map((m) => m.id === tempId ? newMsg : m);
      });
    },
    onError: (_err, _vars, context) => {
      const tempId = context?.tempId;
      queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => {
        return old.filter((m) => m.id !== tempId);
      });
      Alert.alert("Failed to send", "Your message could not be sent. Please try again.");
    },
  });

  const joinMutation = useMutation({
    mutationFn: () => post(`/sessions/${sessionId}/join`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
  });

  const declineInviteMutation = useMutation({
    mutationFn: () => post(`/sessions/${sessionId}/decline`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.back();
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Could not decline invite.");
    },
  });

  const endMutation = useMutation({
    mutationFn: () => patch(`/sessions/${sessionId}`, { status: "completed" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (userId: number) => post(`/sessions/${sessionId}/invite`, { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to invite");
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () => del(`/sessions/${sessionId}/leave`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to leave chat");
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: () => del(`/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to delete session");
    },
  });

  const markPlayedMutation = useMutation({
    mutationFn: (messageId: number) => post(`/sessions/${sessionId}/messages/${messageId}/play`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
    },
  });

  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      post(`/sessions/${sessionId}/messages/${messageId}/react`, { emoji }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
    },
  });

  const loadOlderMessages = async () => {
    if (loadingOlder || messages.length === 0) return;
    isLoadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const older: Message[] = await get(`/sessions/${sessionId}/messages?limit=50&before=${oldest.id}`);
      if (older.length > 0) {
        setHasOlder(older.length === 50);
        queryClient.setQueryData(["messages", sessionId], (prev: Message[] = []) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = older.filter((m) => !existingIds.has(m.id));
          return [...fresh, ...prev];
        });
      } else {
        setHasOlder(false);
      }
    } catch {
      Alert.alert("Error", "Could not load older messages. Please try again.");
    }
    setLoadingOlder(false);
    isLoadingOlderRef.current = false;
  };

  const deleteMutation = useMutation({
    mutationFn: (messageId: number) => del(`/sessions/${sessionId}/messages/${messageId}`),
    onSuccess: (_, messageId) => {
      queryClient.setQueryData<Message[]>(["messages", sessionId], (old) =>
        old ? old.filter((m) => m.id !== messageId) : []
      );
    },
  });

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    setInputHeight(21);
    emitTypingStop(sessionId);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const payload: any = { content: trimmed, type: "text" };
    if (replyToMessage) {
      payload.replyToId = replyToMessage.id;
    }
    sendMutation.mutate(payload);
    setReplyToMessage(null);
  };

  const handlePickImage = async () => {
    setAttachMenuVisible(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to your photo library to send images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets.length) return;

    setUploading(true);
    let failed = 0;
    for (const asset of result.assets) {
      const fileName = asset.fileName || `image_${Date.now()}.jpg`;
      const fileSize = asset.fileSize || 0;
      const contentType = asset.mimeType || "image/jpeg";
      try {
        const uploaded = await uploadFile(asset.uri, fileName, fileSize, contentType);
        sendMutation.mutate({
          content: "",
          type: "image",
          attachmentUrl: uploaded.objectPath,
          attachmentName: fileName,
          attachmentSize: fileSize,
        });
      } catch {
        failed++;
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (failed > 0) Alert.alert("Upload failed", `${failed} file(s) could not be uploaded.`);
    setUploading(false);
  };

  const handlePickVideo = async () => {
    setAttachMenuVisible(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to your photo library to send videos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets.length) return;

    setUploading(true);
    let failed = 0;
    for (const asset of result.assets) {
      const fileName = asset.fileName || `video_${Date.now()}.mp4`;
      const fileSize = asset.fileSize || 0;
      const contentType = asset.mimeType || "video/mp4";
      try {
        const uploaded = await uploadFile(asset.uri, fileName, fileSize, contentType);
        sendMutation.mutate({
          content: "",
          type: "file",
          attachmentUrl: uploaded.objectPath,
          attachmentName: fileName,
          attachmentSize: fileSize,
        });
      } catch {
        failed++;
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (failed > 0) Alert.alert("Upload failed", `${failed} file(s) could not be uploaded.`);
    setUploading(false);
  };

  const handlePickFile = async () => {
    setAttachMenuVisible(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled || !result.assets.length) return;

      setUploading(true);
      let failed = 0;
      for (const asset of result.assets) {
        const fileName = asset.name;
        const fileSize = asset.size || 0;
        const contentType = asset.mimeType || "application/octet-stream";
        try {
          const uploaded = await uploadFile(asset.uri, fileName, fileSize, contentType);
          sendMutation.mutate({
            content: "",
            type: "file",
            attachmentUrl: uploaded.objectPath,
            attachmentName: fileName,
            attachmentSize: fileSize,
          });
        } catch {
          failed++;
        }
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (failed > 0) Alert.alert("Upload failed", `${failed} file(s) could not be uploaded.`);
      setUploading(false);
    } catch {
      setUploading(false);
    }
  };

  const handleStartRecording = async () => {
    setAttachMenuVisible(false);
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow microphone access to send voice notes.");
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setIsRecording(true);
      setRecordingSeconds(0);
      emitRecordingStart(sessionId);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      Alert.alert("Error", "Could not start recording. Make sure microphone access is allowed.");
    }
  };

  const handleCancelRecording = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingSeconds(0);
    emitRecordingStop(sessionId);
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {}
      setRecording(null);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  };

  const handlePauseRecording = async () => {
    if (!recording) return;
    try {
      await recording.pauseAsync();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecordingPaused(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      Alert.alert("Error", "Could not pause recording.");
    }
  };

  const handleResumeRecording = async () => {
    if (!recording) return;
    try {
      await recording.startAsync();
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
      setIsRecordingPaused(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      Alert.alert("Error", "Could not resume recording.");
    }
  };

  const handleStopRecording = async () => {
    if (!recording) return;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setIsRecordingPaused(false);
    setRecordingSeconds(0);
    emitRecordingStop(sessionId);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (!uri) return;

      const fileName = Platform.OS === "web"
        ? `voice_${Date.now()}.webm`
        : `voice_${Date.now()}.m4a`;
      const contentType = Platform.OS === "web" ? "audio/webm" : "audio/m4a";

      setUploading(true);
      try {
        const uploaded = await uploadFile(uri, fileName, 0, contentType);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        sendMutation.mutate({
          content: String(recordingSeconds),
          type: "voice",
          attachmentUrl: uploaded.objectPath,
          attachmentName: fileName,
          attachmentSize: 0,
        });
      } catch (e: any) {
        Alert.alert("Upload failed", e.message || "Could not upload voice note.");
      }
      setUploading(false);
    } catch {
      setRecording(null);
      setUploading(false);
    }
  };

  const handleEndSession = () => {
    confirmAction(
      "End Chat",
      "Are you sure you want to end this chat?",
      "End Chat",
      () => endMutation.mutate()
    );
  };

  const handleDeleteSession = () => {
    Alert.alert(
      "Delete Chat",
      "This will permanently delete the chat and all messages. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteSessionMutation.mutate(),
        },
      ]
    );
  };

  const handleLeaveSession = () => {
    confirmAction(
      "Leave Chat",
      "Are you sure you want to leave this chat?",
      "Leave",
      () => leaveMutation.mutate()
    );
  };

  const openParticipants = () => {
    setSheetView("participants");
    setSheetVisible(true);
  };

  const openInvite = () => {
    setSheetView("invite");
    setSheetVisible(true);
  };

  const isParticipant = session?.participants.some((p) => p.userId === user?.id);
  const hasJoined = session?.participants.some((p) => p.userId === user?.id && p.status === "joined");
  const isActive = session?.status === "active";
  const isCreator = session?.creatorId === user?.id;
  const canSend = isActive && (isCreator || hasJoined);

  const participantIds = new Set(session?.participants.map((p) => p.userId) ?? []);
  const uninvitedContacts = contacts.filter((c) => !participantIds.has(c.contactUser.id));

  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const getEffectivePresence = (userId: number, lastSeenAt?: string | null) => {
    if (onlineUserIds.has(userId)) return "online";
    return getPresenceStatus(userId, lastSeenAt);
  };

  const onlineParticipants = session?.participants.filter(p =>
    getEffectivePresence(p.userId, p.user.lastSeenAt) !== "offline"
  ) ?? [];
  const localParticipants = session?.participants.filter(p =>
    getPresenceStatus(p.userId, p.user.lastSeenAt) === "local"
  ) ?? [];

  if (sessionLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isNotMember) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.navBar, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.navCenter}>
            <Text style={[styles.navTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {sessionPreview?.title ?? "Chat"}
            </Text>
          </View>
          <View style={{ width: 30 }} />
        </View>
        <View style={[styles.center, { padding: 32, gap: 16 }]}>
          {previewLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <View style={[styles.joinLinkIcon, { backgroundColor: colors.accentSoft }]}>
                <Feather name="link" size={32} color={colors.accent} />
              </View>
              <Text style={[styles.joinLinkTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
                You've been invited
              </Text>
              {sessionPreview ? (
                <>
                  <Text style={[styles.joinLinkSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    {sessionPreview.creatorName} invited you to join "{sessionPreview.title}"
                    {sessionPreview.participantCount > 1 ? ` · ${sessionPreview.participantCount} participant${sessionPreview.participantCount !== 1 ? "s" : ""}` : ""}
                  </Text>
                  {sessionPreview.status !== "active" && (
                    <Text style={[styles.joinLinkSub, { color: colors.danger, fontFamily: "Inter_500Medium" }]}>
                      This chat has already ended.
                    </Text>
                  )}
                </>
              ) : null}
              {(!sessionPreview || sessionPreview.status === "active") && (
                <Pressable
                  style={({ pressed }) => [styles.joinLinkBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => joinByLinkMutation.mutate()}
                  disabled={joinByLinkMutation.isPending}
                >
                  {joinByLinkMutation.isPending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={[styles.joinLinkBtnText, { fontFamily: "Inter_600SemiBold" }]}>Join Session</Text>
                  }
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Session not found</Text>
      </View>
    );
  }

  const totalPeople = session.participants.length + 1;
  const totalActive = 1 + onlineParticipants.length;

  const otherPeople = [
    ...(session.creator && session.creator.id !== user?.id ? [{ id: session.creator.id, name: session.creator.name, username: session.creator.username, avatarUrl: session.creator.avatarUrl ?? null, lastSeenAt: session.creator.lastSeenAt ?? null }] : []),
    ...session.participants.filter(p => p.userId !== user?.id).map(p => ({ id: p.userId, name: p.user.name, username: p.user.username, avatarUrl: p.user.avatarUrl ?? null, lastSeenAt: p.user.lastSeenAt ?? null })),
  ];
  const isDirect = totalPeople === 2;
  const headerPerson = isDirect ? otherPeople[0] ?? null : null;

  const activeLabel = isActive
    ? localParticipants.length > 0
      ? `${localParticipants.length + 1} nearby`
      : totalActive === 1
        ? "only you online"
        : `${totalActive} active`
    : "Completed";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          style={styles.navCenter}
          onPress={() => openParticipants()}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {session.imageUrl ? (
              <Image
                source={{ uri: getFileUrl(session.imageUrl) }}
                style={{ width: 34, height: 34, borderRadius: 17 }}
                resizeMode="cover"
              />
            ) : headerPerson ? (
              <UserAvatar
                name={session.title}
                avatarUrl={headerPerson.avatarUrl}
                size={34}
                showDot={true}
                presenceStatus={getEffectivePresence(headerPerson.id, headerPerson.lastSeenAt) as any}
              />
            ) : (
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 16, color: colors.accent, fontFamily: "Inter_700Bold", lineHeight: 20 }}>
                  {session.title.trim().charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.navTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                {session.title}
              </Text>
              <Text style={[styles.navSub, { fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                <Text style={{ color: colors.textTertiary }}>{"› "}</Text>
                <Text style={{ color: colors.textSecondary }}>{`${totalPeople} participant${totalPeople !== 1 ? "s" : ""}`}</Text>
                <Text style={{ color: colors.textSecondary }}>{" · "}</Text>
                <Text style={{ color: isActive ? colors.success : colors.textTertiary, fontFamily: "Inter_500Medium" }}>{activeLabel}</Text>
              </Text>
            </View>
          </View>
        </Pressable>
        <View style={styles.navActions}>
          <Pressable
            style={({ pressed }) => [styles.navIconBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(`/session/call/${sessionId}?mode=voice` as any);
            }}
          >
            <Feather name="phone" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.navIconBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(`/session/call/${sessionId}?mode=video` as any);
            }}
          >
            <Feather name="video" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.navIconBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setMoreMenuVisible(true);
            }}
          >
            <Feather name="more-vertical" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {session.description && (
        <Animated.View entering={FadeIn} style={[styles.descBanner, { backgroundColor: colors.accentSoft, borderBottomColor: colors.border }]}>
          <Feather name="info" size={14} color={colors.accent} />
          <Text style={[styles.descText, { color: colors.accent, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
            {session.description}
          </Text>
        </Animated.View>
      )}

      {!isCreator && isParticipant && !hasJoined && isActive && (
        <Animated.View entering={FadeIn} style={[styles.joinBanner, { backgroundColor: colors.accentSoft, borderBottomColor: colors.border }]}>
          <Text style={[styles.joinText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>
            You've been invited to this chat
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={({ pressed }) => [styles.declineInviteBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              onPress={() => declineInviteMutation.mutate()}
              disabled={declineInviteMutation.isPending}
            >
              <Text style={[styles.declineInviteBtnText, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
                Decline
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.joinBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
              onPress={() => joinMutation.mutate()}
              disabled={joinMutation.isPending}
            >
              {joinMutation.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[styles.joinBtnText, { fontFamily: "Inter_600SemiBold" }]}>Join</Text>
              }
            </Pressable>
          </View>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        {attachMenuVisible && (
          <Pressable
            style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]}
            onPress={() => setAttachMenuVisible(false)}
          />
        )}
        {!socketConnected && isActive && (
          <View style={[styles.pollErrorBanner, { backgroundColor: "#FFF3CD", borderBottomColor: "#FFEAA7" }]}>
            <Feather name="wifi-off" size={14} color="#856404" />
            <Text style={[styles.pollErrorText, { color: "#856404", fontFamily: "Inter_500Medium" }]}>
              Reconnecting…
            </Text>
          </View>
        )}

        {uploading && (
          <View style={[styles.uploadingBanner, { backgroundColor: colors.accentSoft, borderBottomColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[styles.uploadingText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>
              Uploading…
            </Text>
          </View>
        )}

        {msgsLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item, index }) => {
              const isOwn = item.senderId === user?.id;
              const prev = messages[index - 1];
              const next = messages[index + 1];
              const showSender = !prev || prev.senderId !== item.senderId;
              const showAvatar = !prev || prev.senderId !== item.senderId;
              return (
                <MessageBubble
                  message={item}
                  isOwn={isOwn}
                  showSender={showSender}
                  showAvatar={showAvatar}
                  currentUser={user ?? null}
                  colors={colors}
                  getFileUrl={getFileUrl}
                  onPlayed={item.type === "voice" && !isOwn ? () => markPlayedMutation.mutate(item.id) : undefined}
                  onLongPress={() => setActionMenuMessage(item)}
                  onReact={(emoji) => reactMutation.mutate({ messageId: item.id, emoji })}
                  onReactionPress={(reaction, isMine) => {
                    if (isMine) {
                      reactMutation.mutate({ messageId: item.id, emoji: reaction.emoji });
                    } else {
                      setReactorsModal({ reaction, messageId: item.id });
                    }
                  }}
                  senderPresenceStatus={isOwn ? "online" : getEffectivePresence(item.senderId, item.sender.lastSeenAt) as any}
                  onAvatarPress={setProfileViewUser}
                  onImagePress={openImageViewer}
                  onVideoPress={(url, name) => setVideoViewer({ url, name })}
                />
              );
            }}
            contentContainerStyle={[
              styles.messageList,
              { paddingBottom: canSend ? 0 : bottomPad + 20 },
            ]}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              hasOlder ? (
                <Pressable
                  style={({ pressed }) => [styles.loadOlderBtn, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
                  onPress={loadOlderMessages}
                  disabled={loadingOlder}
                >
                  {loadingOlder
                    ? <ActivityIndicator size="small" color={colors.accent} />
                    : <>
                        <Feather name="chevron-up" size={14} color={colors.textSecondary} />
                        <Text style={[styles.loadOlderText, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
                          Load older messages
                        </Text>
                      </>
                  }
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <Feather name="message-circle" size={40} color={colors.textTertiary} />
                <Text style={[styles.emptyMessagesText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                  {canSend ? "Start the conversation" : "No messages yet"}
                </Text>
                {isActive && isCreator && uninvitedContacts.length > 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.inviteHint, { backgroundColor: colors.accentSoft, opacity: pressed ? 0.8 : 1 }]}
                    onPress={openInvite}
                  >
                    <Feather name="user-plus" size={14} color={colors.accent} />
                    <Text style={[styles.inviteHintText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>
                      Invite contacts to join
                    </Text>
                  </Pressable>
                )}
              </View>
            }
          />
        )}

        {recordingParticipantNames.length > 0 && canSend && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[styles.typingBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <Feather name="mic" size={13} color={colors.danger} />
            <Text style={[styles.typingText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              {recordingParticipantNames.length === 1
                ? `${recordingParticipantNames[0]} is recording a voice note…`
                : recordingParticipantNames.length === 2
                ? `${recordingParticipantNames[0]} and ${recordingParticipantNames[1]} are recording…`
                : `${recordingParticipantNames[0]} and ${recordingParticipantNames.length - 1} others are recording…`}
            </Text>
          </Animated.View>
        )}

        {typingParticipantNames.length > 0 && canSend && (
          <Animated.View entering={FadeIn.duration(200)} style={[styles.typingBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            <View style={styles.typingDots}>
              {[0, 1, 2].map((i) => (
                <Animated.View
                  key={i}
                  style={[styles.typingDot, { backgroundColor: colors.accent }]}
                />
              ))}
            </View>
            <Text style={[styles.typingText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              {typingParticipantNames.length === 1
                ? `${typingParticipantNames[0]} is typing…`
                : typingParticipantNames.length === 2
                ? `${typingParticipantNames[0]} and ${typingParticipantNames[1]} are typing…`
                : `${typingParticipantNames[0]} and ${typingParticipantNames.length - 1} others are typing…`}
            </Text>
          </Animated.View>
        )}

        {canSend && (
          <View style={[styles.inputBar, {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: bottomPad + 8,
            zIndex: attachMenuVisible ? 20 : 1,
          }]}>
            {attachMenuVisible && (
              <Animated.View
                entering={FadeInDown.duration(160).springify()}
                style={[styles.attachPopup, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Pressable
                  style={({ pressed }) => [styles.attachIconTile, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
                  onPress={handlePickImage}
                >
                  <View style={[styles.attachIconCircle, { backgroundColor: "#E3F2FD" }]}>
                    <Feather name="image" size={18} color="#1976D2" />
                  </View>
                  <Text style={[styles.attachIconLabel, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Photo</Text>
                </Pressable>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                <Pressable
                  style={({ pressed }) => [styles.attachIconTile, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
                  onPress={handlePickVideo}
                >
                  <View style={[styles.attachIconCircle, { backgroundColor: "#E8F5E9" }]}>
                    <Feather name="video" size={18} color="#388E3C" />
                  </View>
                  <Text style={[styles.attachIconLabel, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Video</Text>
                </Pressable>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                <Pressable
                  style={({ pressed }) => [styles.attachIconTile, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
                  onPress={handlePickFile}
                >
                  <View style={[styles.attachIconCircle, { backgroundColor: "#F3E5F5" }]}>
                    <Feather name="file-text" size={18} color="#7B1FA2" />
                  </View>
                  <Text style={[styles.attachIconLabel, { color: colors.text, fontFamily: "Inter_500Medium" }]}>File</Text>
                </Pressable>
              </Animated.View>
            )}
            {replyToMessage && (
              <View style={[styles.replyBar, { backgroundColor: colors.surfaceAlt, borderLeftColor: colors.accent }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.replyBarName, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                    {replyToMessage.senderId === user?.id ? "You" : replyToMessage.sender.name}
                  </Text>
                  <Text style={[styles.replyBarText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                    {replyToMessage.type !== "text" ? `[${replyToMessage.type}]` : replyToMessage.content}
                  </Text>
                </View>
                <Pressable onPress={() => setReplyToMessage(null)} style={{ padding: 4 }}>
                  <Feather name="x" size={16} color={colors.textTertiary} />
                </Pressable>
              </View>
            )}
            {isRecording ? (
              <View style={styles.recordingRow}>
                <UserAvatar name={user?.name ?? "?"} avatarUrl={user?.avatarUrl} size={30} showDot={false} />
                <Pressable
                  style={({ pressed }) => [styles.recordingCancelBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={handleCancelRecording}
                >
                  <Feather name="x" size={18} color={colors.textSecondary} />
                </Pressable>
                <View style={[styles.recordingBar, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <View style={[styles.recordingDot, {
                    backgroundColor: isRecordingPaused ? colors.textTertiary : colors.danger,
                    opacity: isRecordingPaused ? 1 : 1,
                  }]} />
                  <Text style={[styles.recordingText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>
                    {`${Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:${(recordingSeconds % 60).toString().padStart(2, "0")}`}
                  </Text>
                  <Text style={[styles.recordingLabel, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    {isRecordingPaused ? "Paused" : "Recording…"}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.recordingPauseBtn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={isRecordingPaused ? handleResumeRecording : handlePauseRecording}
                >
                  <Feather name={isRecordingPaused ? "play" : "pause"} size={18} color={colors.accent} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.sendBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                  onPress={handleStopRecording}
                >
                  <Feather name="send" size={18} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [styles.attachBtn, { backgroundColor: attachMenuVisible ? colors.accent : colors.surfaceAlt, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setAttachMenuVisible(v => !v)}
                  disabled={uploading}
                >
                  <Feather name={attachMenuVisible ? "x" : "plus"} size={20} color={attachMenuVisible ? "#fff" : colors.accent} />
                </Pressable>
                <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, height: Math.min(Math.max(inputHeight + 20, 42), 160) }]}>
                  <TextInput
                    style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular", height: inputHeight }]}
                    placeholder="Type a message…"
                    placeholderTextColor={colors.textTertiary}
                    value={text}
                    onChangeText={handleTextChange}
                    onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)}
                    multiline
                    maxLength={2000}
                    scrollEnabled
                  />
                </View>
                {text.trim() ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.sendBtn,
                      { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
                    ]}
                    onPress={handleSend}
                    disabled={sendMutation.isPending || uploading}
                  >
                    <Feather name="send" size={18} color="#fff" />
                  </Pressable>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.sendBtn,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
                    ]}
                    onPress={handleStartRecording}
                    disabled={uploading}
                  >
                    <Feather name="mic" size={18} color={colors.accent} />
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}

        {!isActive && (() => {
          const start = session?.createdAt ? new Date(session.createdAt) : null;
          const end = session?.endedAt ? new Date(session.endedAt) : null;
          const durationMs = start && end ? end.getTime() - start.getTime() : 0;
          const durationMin = Math.round(durationMs / 60000);
          const durationStr = durationMin >= 60
            ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
            : `${durationMin}m`;
          const msgCount = messages.length;
          const mediaCount = messages.filter(m => m.type === "image" || m.type === "file" || m.type === "voice").length;
          const participantCount = session?.participants.length ?? 0;

          return (
            <View style={[styles.insightsCard, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border, paddingBottom: bottomPad + 8 }]}>
              <View style={styles.insightsHeader}>
                <View style={[styles.insightsIcon, { backgroundColor: colors.accentSoft }]}>
                  <Feather name="check-circle" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.insightsTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>Session Complete</Text>
              </View>
              <View style={styles.insightsRow}>
                <View style={styles.insightsStat}>
                  <Feather name="clock" size={14} color={colors.textSecondary} />
                  <Text style={[styles.insightsStatValue, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>{durationStr}</Text>
                  <Text style={[styles.insightsStatLabel, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>Duration</Text>
                </View>
                <View style={[styles.insightsDivider, { backgroundColor: colors.border }]} />
                <View style={styles.insightsStat}>
                  <Feather name="message-circle" size={14} color={colors.textSecondary} />
                  <Text style={[styles.insightsStatValue, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>{msgCount}</Text>
                  <Text style={[styles.insightsStatLabel, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>Messages</Text>
                </View>
                <View style={[styles.insightsDivider, { backgroundColor: colors.border }]} />
                <View style={styles.insightsStat}>
                  <Feather name="image" size={14} color={colors.textSecondary} />
                  <Text style={[styles.insightsStatValue, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>{mediaCount}</Text>
                  <Text style={[styles.insightsStatLabel, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>Media</Text>
                </View>
                <View style={[styles.insightsDivider, { backgroundColor: colors.border }]} />
                <View style={styles.insightsStat}>
                  <Feather name="users" size={14} color={colors.textSecondary} />
                  <Text style={[styles.insightsStatValue, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>{participantCount}</Text>
                  <Text style={[styles.insightsStatLabel, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>People</Text>
                </View>
              </View>
              <Text style={[styles.insightsEnded, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                Ended {session?.endedAt ? formatRelative(session.endedAt) : ""}
              </Text>
            </View>
          );
        })()}
      </KeyboardAvoidingView>

      <Modal
        visible={actionMenuMessage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenuMessage(null)}
      >
        <Pressable
          style={styles.attachOverlay}
          onPress={() => setActionMenuMessage(null)}
        >
          <Pressable onPress={() => {}} style={[styles.actionMenuSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {actionMenuMessage && (
              <View style={[styles.actionMenuPreview, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13 }]} numberOfLines={2}>
                  {actionMenuMessage.type !== "text" ? `[${actionMenuMessage.type}]` : actionMenuMessage.content}
                </Text>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.actionMenuRow}
              contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}
              keyboardShouldPersistTaps="always"
            >
              {getSortedEmojis(emojiUsage).map((emoji) => (
                <Pressable
                  key={emoji}
                  style={({ pressed }) => [styles.reactionPickerEmoji, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => {
                    if (actionMenuMessage) {
                      reactMutation.mutate({ messageId: actionMenuMessage.id, emoji });
                      trackEmojiUsage(emoji);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setActionMenuMessage(null);
                  }}
                >
                  <Text style={{ fontSize: 26 }}>{emoji}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[styles.actionMenuDivider, { backgroundColor: colors.border }]} />
            {actionMenuMessage?.type === "text" && actionMenuMessage.content && (
              <Pressable
                style={({ pressed }) => [styles.actionMenuItem, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => {
                  if (actionMenuMessage) Clipboard.setStringAsync(actionMenuMessage.content);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setActionMenuMessage(null);
                }}
              >
                <Feather name="copy" size={18} color={colors.text} />
                <Text style={[styles.actionMenuItemText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Copy</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.actionMenuItem, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => {
                const msg = actionMenuMessage;
                setActionMenuMessage(null);
                if (msg) setReplyToMessage(msg);
              }}
            >
              <Feather name="corner-up-left" size={18} color={colors.text} />
              <Text style={[styles.actionMenuItemText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Reply</Text>
            </Pressable>
            {actionMenuMessage?.senderId === user?.id && (
              <Pressable
                style={({ pressed }) => [styles.actionMenuItem, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => {
                  const msg = actionMenuMessage;
                  setActionMenuMessage(null);
                  if (msg) {
                    confirmAction(
                      "Delete Message",
                      "Are you sure you want to delete this message? This cannot be undone.",
                      () => deleteMutation.mutate(msg.id)
                    );
                  }
                }}
              >
                <Feather name="trash-2" size={18} color={colors.danger} />
                <Text style={[styles.actionMenuItemText, { color: colors.danger, fontFamily: "Inter_500Medium" }]}>Delete</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={reactionPickerMessage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setReactionPickerMessage(null);
          setShowCustomEmoji(false);
          setCustomEmojiInput("");
        }}
      >
        <Pressable
          style={[styles.attachOverlay, { paddingBottom: Math.max(24, reactionKeyboardHeight + 12) }]}
          onPress={() => {
            Keyboard.dismiss();
            setReactionPickerMessage(null);
            setShowCustomEmoji(false);
            setCustomEmojiInput("");
          }}
        >
          <Pressable onPress={() => {}} style={[styles.reactionPickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.attachTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
              React to message
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.reactionPickerRow}
              contentContainerStyle={{ gap: 4, paddingHorizontal: 4 }}
              keyboardShouldPersistTaps="always"
            >
              {getSortedEmojis(emojiUsage).map((emoji) => (
                <Pressable
                  key={emoji}
                  style={({ pressed }) => [styles.reactionPickerEmoji, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => {
                    if (reactionPickerMessage) {
                      reactMutation.mutate({ messageId: reactionPickerMessage.id, emoji });
                      trackEmojiUsage(emoji);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setReactionPickerMessage(null);
                    setShowCustomEmoji(false);
                    setCustomEmojiInput("");
                  }}
                >
                  <Text style={{ fontSize: 30 }}>{emoji}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={moreMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreMenuVisible(false)}
      >
        <Pressable style={styles.moreOverlay} onPress={() => setMoreMenuVisible(false)}>
          <Pressable style={[styles.moreMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              style={({ pressed }) => [styles.moreMenuItem, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => { setMoreMenuVisible(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/session/media/${sessionId}` as any); }}
            >
              <Feather name="image" size={20} color={colors.textSecondary} />
              <Text style={[styles.moreMenuItemText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Media</Text>
            </Pressable>
            <View style={[styles.moreMenuDivider, { backgroundColor: colors.border }]} />
            <Pressable
              style={({ pressed }) => [styles.moreMenuItem, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => { setMoreMenuVisible(false); openParticipants(); }}
            >
              <Feather name="users" size={20} color={colors.textSecondary} />
              <Text style={[styles.moreMenuItemText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Participants</Text>
            </Pressable>
            {isActive && isCreator && (
              <>
                <View style={[styles.moreMenuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  style={({ pressed }) => [styles.moreMenuItem, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => { setMoreMenuVisible(false); handleEndSession(); }}
                >
                  <Feather name="stop-circle" size={20} color={colors.danger} />
                  <Text style={[styles.moreMenuItemText, { color: colors.danger, fontFamily: "Inter_500Medium" }]}>End Session</Text>
                </Pressable>
                <View style={[styles.moreMenuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  style={({ pressed }) => [styles.moreMenuItem, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => { setMoreMenuVisible(false); handleDeleteSession(); }}
                >
                  <Feather name="trash-2" size={20} color={colors.danger} />
                  <Text style={[styles.moreMenuItemText, { color: colors.danger, fontFamily: "Inter_500Medium" }]}>Delete Session</Text>
                </Pressable>
              </>
            )}
            {!isActive && isCreator && (
              <>
                <View style={[styles.moreMenuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  style={({ pressed }) => [styles.moreMenuItem, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => { setMoreMenuVisible(false); handleDeleteSession(); }}
                >
                  <Feather name="trash-2" size={20} color={colors.danger} />
                  <Text style={[styles.moreMenuItemText, { color: colors.danger, fontFamily: "Inter_500Medium" }]}>Delete Session</Text>
                </Pressable>
              </>
            )}
            {isActive && !isCreator && hasJoined && (
              <>
                <View style={[styles.moreMenuDivider, { backgroundColor: colors.border }]} />
                <Pressable
                  style={({ pressed }) => [styles.moreMenuItem, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => { setMoreMenuVisible(false); handleLeaveSession(); }}
                >
                  <Feather name="log-out" size={20} color={colors.danger} />
                  <Text style={[styles.moreMenuItemText, { color: colors.danger, fontFamily: "Inter_500Medium" }]}>Leave Session</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={profileViewUser !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileViewUser(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" }}
          onPress={() => setProfileViewUser(null)}
        >
          <Pressable
            style={{ alignItems: "center", gap: 16 }}
            onPress={() => {}}
          >
            {profileViewUser && (
              <UserAvatar
                name={profileViewUser.name}
                avatarUrl={profileViewUser.avatarUrl}
                size={160}
                presenceStatus={profileViewUser.presenceStatus}
                showDot={true}
              />
            )}
            {profileViewUser && (
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ color: "#fff", fontSize: 22, fontFamily: "Inter_600SemiBold" }}>
                  {profileViewUser.name}
                </Text>
                {profileViewUser.username ? (
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 15, fontFamily: "Inter_400Regular" }}>
                    @{profileViewUser.username}
                  </Text>
                ) : null}
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 }}>
                  {profileViewUser.presenceStatus === "online" || profileViewUser.presenceStatus === "local"
                    ? "Online"
                    : "Offline"}
                </Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={sheetVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSheetVisible(false)}
      >
        <View style={[styles.sheetContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            {sheetView === "invite" && isCreator ? (
              <>
                <Pressable onPress={() => setSheetView("participants")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Feather name="arrow-left" size={22} color={colors.text} />
                </Pressable>
                <Text style={[styles.sheetTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>Invite Contacts</Text>
              </>
            ) : (
              <>
                <View style={{ width: 22 }} />
                <Text style={[styles.sheetTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>Participants</Text>
              </>
            )}
            <Pressable onPress={() => setSheetVisible(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Feather name="x" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {sheetView === "participants" ? (
            <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <View style={[styles.chatInfoBlock, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 10 }}>
                  {session.imageUrl ? (
                    <Image
                      source={{ uri: getFileUrl(session.imageUrl) }}
                      style={{ width: 64, height: 64, borderRadius: 16 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
                      <Feather name="message-circle" size={28} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={{ flex: 1, paddingTop: 2 }}>
                    <Text style={[styles.chatInfoTitle, { color: colors.text, fontFamily: "Inter_700Bold", marginBottom: 4 }]}>
                      {session.title}
                    </Text>
                    {session.description ? (
                      <Text style={[styles.chatInfoDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 0 }]}>
                        {session.description}
                      </Text>
                    ) : (
                      <Text style={[styles.chatInfoDesc, { color: colors.textTertiary, fontFamily: "Inter_400Regular", marginBottom: 0 }]}>
                        No description
                      </Text>
                    )}
                  </View>
                </View>
                <View style={[styles.chatInfoMeta, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <Feather name="users" size={13} color={colors.textSecondary} />
                  <Text style={[styles.chatInfoMetaText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    {totalPeople} participant{totalPeople !== 1 ? "s" : ""}
                  </Text>
                  <Text style={[styles.chatInfoMetaSep, { color: colors.border }]}>·</Text>
                  <View style={[styles.chatInfoStatusDot, { backgroundColor: isActive ? colors.success : colors.textTertiary }]} />
                  <Text style={[styles.chatInfoMetaText, { color: isActive ? colors.success : colors.textTertiary, fontFamily: "Inter_500Medium" }]}>
                    {isActive ? "Active" : "Ended"}
                  </Text>
                </View>
              </View>
              <Text style={[styles.chatInfoSectionLabel, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
                PARTICIPANTS
              </Text>
              <View style={[styles.participantRow, { borderBottomColor: colors.border }]}>
                {(() => {
                  const creatorId = session.creator?.id ?? session.creatorId;
                  const creatorStatus = getEffectivePresence(creatorId, session.creator?.lastSeenAt);
                  const statusColor = creatorStatus === "local" ? "#FF6B9D" : creatorStatus === "online" ? colors.success : colors.textSecondary;
                  const statusText = creatorStatus === "local" ? "On this network" : creatorStatus === "online" ? "Online" : `Last seen ${formatLastSeen(session.creator?.lastSeenAt)}`;
                  return (
                    <>
                      <UserAvatar
                        name={session.creator?.name ?? (isCreator ? user?.name ?? "?" : "?")}
                        avatarUrl={session.creator?.avatarUrl ?? (isCreator ? user?.avatarUrl : null)}
                        size={44}
                        presenceStatus={creatorStatus}
                        showDot
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.participantName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                          {session.creator?.name ?? (isCreator ? user?.name : "Unknown")}
                        </Text>
                        <Text style={[styles.participantUsername, { color: statusColor, fontFamily: "Inter_400Regular" }]}>
                          {statusText}
                        </Text>
                      </View>
                      <View style={[styles.rolePill, { backgroundColor: colors.accentSoft }]}>
                        <Text style={[styles.rolePillText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>Creator</Text>
                      </View>
                    </>
                  );
                })()}
              </View>

              {session.participants.filter(p => p.userId !== session.creatorId).map((p) => {
                const pStatus = getEffectivePresence(p.userId, p.user.lastSeenAt);
                const pStatusColor = pStatus === "local" ? "#FF6B9D" : pStatus === "online" ? colors.success : colors.textSecondary;
                const pStatusText = pStatus === "local" ? "On this network" : pStatus === "online" ? "Online" : `Last seen ${formatLastSeen(p.user.lastSeenAt)}`;
                return (
                <View key={p.id} style={[styles.participantRow, { borderBottomColor: colors.border }]}>
                  <UserAvatar
                    name={p.user.name}
                    avatarUrl={p.user.avatarUrl}
                    size={44}
                    presenceStatus={pStatus}
                    showDot
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.participantName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                      {p.user.name}
                    </Text>
                    <Text style={[styles.participantUsername, { color: pStatusColor, fontFamily: "Inter_400Regular" }]}>
                      {pStatusText}
                    </Text>
                  </View>
                  <View style={[
                    styles.statusChip,
                    { backgroundColor: p.status === "joined" ? "#E8F5E9" : colors.surfaceAlt }
                  ]}>
                    <Text style={[
                      styles.statusChipText,
                      { color: p.status === "joined" ? "#388E3C" : colors.textSecondary, fontFamily: "Inter_500Medium" }
                    ]}>
                      {p.status === "joined" ? "Joined" : "Invited"}
                    </Text>
                  </View>
                </View>
                );
              })}

              {isActive && isCreator && (
                <Pressable
                  style={({ pressed }) => [styles.inviteMoreBtn, { backgroundColor: colors.accentSoft, opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => setSheetView("invite")}
                >
                  <Feather name="user-plus" size={18} color={colors.accent} />
                  <Text style={[styles.inviteMoreText, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]}>
                    Invite More Contacts
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={[styles.sheetScroll, { padding: 16 }]} showsVerticalScrollIndicator={false}>
              <Pressable
                style={({ pressed }) => [styles.shareTextBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
                onPress={shareSessionLink}
              >
                <View style={[styles.shareTextIcon, { backgroundColor: "#E8F5E9" }]}>
                  <Feather name="message-circle" size={20} color="#388E3C" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.shareTextLabel, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                    Share via Text Message
                  </Text>
                  <Text style={[styles.shareTextSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    Send an invite link to any phone contact
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>

              <Text style={[styles.orDivider, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                — or invite from your contacts —
              </Text>

              {uninvitedContacts.length === 0 ? (
                <View style={styles.emptySheet}>
                  <Feather name="users" size={36} color={colors.textTertiary} />
                  <Text style={[styles.emptySheetText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    All your contacts are already in this chat
                  </Text>
                </View>
              ) : (
                uninvitedContacts.map((contact) => (
                  <View key={contact.id} style={[styles.participantRow, { borderBottomColor: colors.border }]}>
                    <View style={[styles.participantAvatar, { backgroundColor: colors.accentSoft }]}>
                      <Text style={[styles.participantAvatarText, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
                        {contact.contactUser.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.participantName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                        {contact.contactUser.name}
                      </Text>
                      <Text style={[styles.participantUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                        @{contact.contactUser.username}
                      </Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.inviteBtn,
                        { backgroundColor: inviteMutation.isPending ? colors.surfaceAlt : colors.accent, opacity: pressed ? 0.8 : 1 }
                      ]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        inviteMutation.mutate(contact.contactUser.id);
                      }}
                      disabled={inviteMutation.isPending}
                    >
                      <Text style={[styles.inviteBtnText, { fontFamily: "Inter_600SemiBold" }]}>Invite</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal visible={videoViewer !== null} transparent animationType="fade" onRequestClose={() => setVideoViewer(null)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {/* Video fills the screen */}
          <VideoView
            player={inAppVideoPlayer}
            style={{ flex: 1, width: "100%" }}
            contentFit="contain"
            nativeControls={false}
          />

          {/* Controls overlay — always box-none so all child touches go to their targets */}
          <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, vpAnimStyle]} pointerEvents="box-none">

            {/* TOP BAR */}
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top + 8, paddingBottom: 14, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.5)" }}>
              <Pressable onPress={() => setVideoViewer(null)} style={{ padding: 8 }}>
                <Feather name="x" size={22} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" }} numberOfLines={1}>{videoViewer?.name}</Text>
              <Pressable onPress={vpToggleLoop} style={{ padding: 8, backgroundColor: vpLooping ? "rgba(255,107,157,0.3)" : "rgba(255,255,255,0.12)", borderRadius: 8 }}>
                <Feather name="repeat" size={16} color={vpLooping ? "#FF6B9D" : "#fff"} />
              </Pressable>
              <Pressable onPress={vpToggleMute} style={{ padding: 8, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8 }}>
                <Feather name={vpMuted ? "volume-x" : "volume-2"} size={16} color="#fff" />
              </Pressable>
              <Pressable onPress={() => { setVpSpeedOpen(true); vpShowControls(); }} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8 }}>
                <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{vpRate}×</Text>
              </Pressable>
            </View>

            {/* MIDDLE: left zone | center buttons | right zone */}
            <View style={{ position: "absolute", top: insets.top + 70, left: 0, right: 0, bottom: insets.bottom + 90, flexDirection: "row" }} pointerEvents="box-none">
              {/* Left zone: single tap = toggle controls, double tap = seek -5s */}
              <Pressable style={{ flex: 1 }} onPress={handleTapLeft} />

              {/* Center buttons */}
              <View style={{ width: 200, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 28 }}>
                <Pressable
                  onPress={() => { inAppVideoPlayer.seekBy(-5); vpShowControls(); }}
                  style={{ alignItems: "center", gap: 4 }}
                >
                  <Feather name="rotate-ccw" size={26} color="#fff" />
                  <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, fontFamily: "Inter_500Medium" }}>5s</Text>
                </Pressable>
                <Pressable
                  onPress={() => { if (vpIsPlaying) inAppVideoPlayer.pause(); else inAppVideoPlayer.play(); vpShowControls(); }}
                  style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}
                >
                  <Feather name={vpIsPlaying ? "pause" : "play"} size={28} color="#fff" style={vpIsPlaying ? {} : { marginLeft: 4 }} />
                </Pressable>
                <Pressable
                  onPress={() => { inAppVideoPlayer.seekBy(5); vpShowControls(); }}
                  style={{ alignItems: "center", gap: 4 }}
                >
                  <Feather name="rotate-cw" size={26} color="#fff" />
                  <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, fontFamily: "Inter_500Medium" }}>5s</Text>
                </Pressable>
              </View>

              {/* Right zone: single tap = toggle controls, double tap = seek +5s */}
              <Pressable style={{ flex: 1 }} onPress={handleTapRight} />
            </View>

            {/* BOTTOM BAR */}
            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 14, paddingHorizontal: 16, paddingTop: 14, backgroundColor: "rgba(0,0,0,0.5)", gap: 8 }}>
              {/* Seek bar */}
              <View
                style={{ height: 28, justifyContent: "center" }}
                onLayout={(e) => setVpBarWidth(e.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => {
                  const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / vpBarWidth));
                  inAppVideoPlayer.currentTime = ratio * vpDuration;
                  vpShowControls();
                }}
                onResponderMove={(e) => {
                  const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / vpBarWidth));
                  inAppVideoPlayer.currentTime = ratio * vpDuration;
                }}
              >
                <View style={{ height: 3, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 2 }}>
                  <View style={{ width: `${Math.min(100, (vpCurrentTime / Math.max(vpDuration, 0.001)) * 100)}%`, height: "100%", backgroundColor: "#FF6B9D", borderRadius: 2 }} />
                </View>
                <View style={{ position: "absolute", left: `${Math.min(100, (vpCurrentTime / Math.max(vpDuration, 0.001)) * 100)}%`, width: 13, height: 13, borderRadius: 7, backgroundColor: "#fff", top: 7.5, marginLeft: -6.5 }} />
              </View>
              {/* Time + download row */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: "Inter_500Medium" }}>{vpFormatTime(vpCurrentTime)}</Text>
                <Pressable onPress={vpDownloadVideo} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8 }} disabled={vpDownloading}>
                  <Feather name={vpDownloading ? "loader" : "download"} size={14} color={vpDownloading ? "rgba(255,255,255,0.5)" : "#fff"} />
                  <Text style={{ color: vpDownloading ? "rgba(255,255,255,0.5)" : "#fff", fontSize: 12, fontFamily: "Inter_500Medium" }}>{vpDownloading ? "Saving…" : "Save to gallery"}</Text>
                </Pressable>
                <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: "Inter_500Medium" }}>{vpFormatTime(vpDuration)}</Text>
              </View>
            </View>
          </Animated.View>

          {/* Speed picker sheet */}
          {vpSpeedOpen && (
            <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "flex-end" }} onPress={() => setVpSpeedOpen(false)}>
              <View style={{ width: "100%", backgroundColor: "#1a1a1a", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 16, paddingTop: 12 }}>
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center", marginBottom: 12, letterSpacing: 1 }}>PLAYBACK SPEED</Text>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <Pressable key={rate} onPress={() => vpSetRate(rate)} style={{ paddingVertical: 14, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ color: rate === vpRate ? "#FF6B9D" : "#fff", fontSize: 16, fontFamily: rate === vpRate ? "Inter_600SemiBold" : "Inter_400Regular" }}>
                      {rate === 1 ? "Normal" : `${rate}×`}
                    </Text>
                    {rate === vpRate && <Feather name="check" size={18} color="#FF6B9D" />}
                  </Pressable>
                ))}
              </View>
            </Pressable>
          )}
        </View>
      </Modal>

      <Modal visible={viewerImageIndex !== null} transparent animationType="fade" onRequestClose={() => setViewerImageIndex(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.93)" }} {...viewerPanResponder.panHandlers}>
          <Pressable style={{ position: "absolute", top: 60, right: 20, zIndex: 10, padding: 8 }} onPress={() => setViewerImageIndex(null)}>
            <Feather name="x" size={26} color="#fff" />
          </Pressable>
          {viewerImageIndex !== null && chatImageUrls.length > 1 && (
            <View style={{ position: "absolute", top: 66, left: 0, right: 0, alignItems: "center", zIndex: 10 }}>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
                {viewerImageIndex + 1} / {chatImageUrls.length}
              </Text>
            </View>
          )}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            {viewerImageIndex !== null && chatImageUrls[viewerImageIndex] && (
              <Image
                source={{ uri: chatImageUrls[viewerImageIndex] }}
                style={{ width: Dimensions.get("window").width, height: Dimensions.get("window").width * 1.2 }}
                resizeMode="contain"
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={reactorsModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReactorsModal(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}
          onPress={() => setReactorsModal(null)}
        >
          <Pressable style={[{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 24, borderWidth: 1, borderColor: colors.border }]}>
            <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 8 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>
            {reactorsModal && (
              <>
                <View style={{ paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 24, textAlign: "center" }}>{reactorsModal.reaction.emoji}</Text>
                  <Text style={[{ color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 2, fontFamily: "Inter_400Regular" }]}>
                    {reactorsModal.reaction.count} {reactorsModal.reaction.count === 1 ? "person" : "people"} reacted
                  </Text>
                </View>
                <View style={{ paddingTop: 8, paddingHorizontal: 16 }}>
                  {(reactorsModal.reaction.reactors ?? reactorsModal.reaction.userIds.map(id => ({ id, name: "User" }))).map((reactor) => {
                    const isMe = reactor.id === user?.id;
                    return (
                      <View key={reactor.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}>
                        <View style={[{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft }]}>
                          <Text style={[{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.accent }]}>
                            {reactor.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[{ flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.text }]}>
                          {isMe ? "You" : reactor.name}
                        </Text>
                        {isMe && (
                          <Pressable
                            style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.danger + "20", opacity: pressed ? 0.7 : 1 }]}
                            onPress={() => {
                              setReactorsModal(null);
                              reactMutation.mutate({ messageId: reactorsModal.messageId, emoji: reactorsModal.reaction.emoji });
                            }}
                          >
                            <Text style={[{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.danger }]}>Remove</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  navBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: { padding: 4 },
  navCenter: { flex: 1, gap: 2 },
  navTitle: { fontSize: 16 },
  navMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  navSub: { fontSize: 12 },
  navActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  navIconBtn: { padding: 4 },
  endBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginLeft: 4 },
  endBtnText: { fontSize: 13 },
  moreOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 88,
    paddingRight: 12,
  },
  moreMenu: {
    minWidth: 200,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  moreMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  moreMenuItemText: { fontSize: 15 },
  moreMenuDivider: { height: StyleSheet.hairlineWidth },
  descBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  descText: { flex: 1, fontSize: 13, lineHeight: 18 },
  joinBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  joinText: { flex: 1, fontSize: 14 },
  joinBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, alignItems: "center", minWidth: 60 },
  joinBtnText: { color: "#fff", fontSize: 14 },
  declineInviteBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  declineInviteBtnText: { fontSize: 14 },
  messageList: { padding: 12, gap: 4, flexGrow: 1 },
  bubbleRow: { flexDirection: "row", marginVertical: 3, gap: 8 },
  bubbleRowLeft: { justifyContent: "flex-start" },
  bubbleRowRight: { justifyContent: "flex-end" },
  senderAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end",
  },
  senderAvatarText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  senderName: { fontSize: 11, fontFamily: "Inter_400Regular" },
  onlineDotSmall: { width: 7, height: 7, borderRadius: 4 },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  bubbleImage: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  bubbleOwn: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  callRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  callLabel: { fontSize: 14 },
  callDuration: { fontSize: 12, marginTop: 1 },
  imageBubble: {
    width: 200,
    height: 150,
    borderRadius: 14,
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 160,
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  fileName: { fontSize: 14, maxWidth: 110 },
  fileSize: { fontSize: 11, marginTop: 1 },
  voicePlayerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  voicePlayer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 220,
    flex: 1,
  },
  voicePlayBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceWaveform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2.5,
    height: 16,
    flex: 1,
  },
  voiceProgressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    width: "100%",
  },
  voiceProgressFill: {
    height: "100%",
    borderRadius: 2,
    minWidth: 3,
  },
  voiceLabel: { fontSize: 11 },
  bubbleMeta: { flexDirection: "row", alignItems: "center", gap: 3 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  inputWrapper: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  input: { fontSize: 15, lineHeight: 21 },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  recordingRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  recordingCancelBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  recordingBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recordingText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recordingLabel: { fontSize: 13, flex: 1 },
  recordingPauseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadOlderBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 20,
    alignSelf: "center",
    marginBottom: 8,
    minHeight: 36,
    paddingHorizontal: 16,
  },
  loadOlderText: { fontSize: 13 },
  emptyMessages: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 60 },
  emptyMessagesText: { fontSize: 14 },
  inviteHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 4,
  },
  inviteHintText: { fontSize: 14 },
  pollErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pollErrorText: { fontSize: 13 },
  uploadingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  uploadingText: { fontSize: 13 },
  joinLinkIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  joinLinkTitle: { fontSize: 22, textAlign: "center" },
  joinLinkSub: { fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  joinLinkBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    minWidth: 180,
  },
  joinLinkBtnText: { color: "#fff", fontSize: 16 },
  shareTextBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 4,
  },
  shareTextIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  shareTextLabel: { fontSize: 15 },
  shareTextSub: { fontSize: 12, marginTop: 2 },
  orDivider: { textAlign: "center", fontSize: 12, marginVertical: 14 },
  endedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  endedText: { fontSize: 13 },
  attachOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  attachPopup: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    marginBottom: 6,
    flexDirection: "column",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 20,
    minWidth: 140,
  },
  attachIconTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  attachIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  attachIconLabel: { fontSize: 14 },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  sheetContainer: { flex: 1 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 16 },
  sheetScroll: { padding: 0, gap: 0 },
  chatInfoBlock: { padding: 20, gap: 8, paddingBottom: 20 },
  chatInfoTitle: { fontSize: 22, lineHeight: 28 },
  chatInfoDesc: { fontSize: 14, lineHeight: 20 },
  chatInfoMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  chatInfoMetaText: { fontSize: 13 },
  chatInfoMetaSep: { fontSize: 13 },
  chatInfoStatusDot: { width: 7, height: 7, borderRadius: 4 },
  chatInfoSectionLabel: { fontSize: 11, letterSpacing: 0.8, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  participantAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  participantAvatarText: { fontSize: 18, color: "#fff" },
  participantName: { fontSize: 15 },
  participantUsername: { fontSize: 13, marginTop: 1 },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  rolePillText: { fontSize: 11 },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusChipText: { fontSize: 11 },
  inviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  inviteBtnText: { color: "#fff", fontSize: 13 },
  inviteMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    marginTop: 16,
  },
  inviteMoreText: { fontSize: 15 },
  emptySheet: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 60 },
  emptySheetText: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
  reactionPickerSheet: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  reactionPickerRow: {
    paddingVertical: 4,
  },
  reactionPickerEmoji: {
    padding: 8,
  },
  typingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  typingDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    opacity: 0.6,
  },
  typingText: {
    fontSize: 12,
  },
  replyQuote: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  replyQuoteName: { fontSize: 12 },
  replyQuoteText: { fontSize: 12, marginTop: 1 },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginTop: 8,
    gap: 8,
  },
  replyBarName: { fontSize: 12 },
  replyBarText: { fontSize: 12, marginTop: 1 },
  actionMenuSheet: {
    width: "90%",
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  actionMenuPreview: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  actionMenuRow: {
    paddingVertical: 4,
  },
  actionMenuDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  actionMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  actionMenuItemText: { fontSize: 15 },
  insightsCard: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  insightsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  insightsIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  insightsTitle: { fontSize: 14 },
  insightsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  insightsStat: {
    alignItems: "center",
    gap: 3,
    flex: 1,
  },
  insightsStatValue: { fontSize: 16 },
  insightsStatLabel: { fontSize: 10 },
  insightsDivider: { width: 1, height: 30 },
  insightsEnded: { fontSize: 11, textAlign: "center" },
});
