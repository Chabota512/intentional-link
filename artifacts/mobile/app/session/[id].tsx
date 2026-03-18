import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { formatTime, formatRelative } from "@/utils/date";

interface User {
  id: number;
  name: string;
  username: string;
}

interface Message {
  id: number;
  sessionId: number;
  senderId: number;
  content: string;
  status: string;
  createdAt: string;
  sender: User;
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
  creatorId: number;
  status: "active" | "completed";
  participants: Participant[];
  createdAt: string;
  endedAt?: string;
}

function MessageBubble({ message, isOwn, showSender, colors }: {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  colors: ReturnType<typeof import("@/hooks/useTheme").useTheme>["colors"];
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      style={[
        styles.bubbleRow,
        isOwn ? styles.bubbleRowRight : styles.bubbleRowLeft,
      ]}
    >
      {!isOwn && (
        <View style={[styles.senderAvatar, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.senderAvatarText, { color: colors.accent }]}>
            {message.sender.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ maxWidth: "75%", gap: 3 }}>
        {showSender && !isOwn && (
          <Text style={[styles.senderName, { color: colors.textSecondary }]}>
            {message.sender.name}
          </Text>
        )}
        <View
          style={[
            styles.bubble,
            isOwn
              ? [styles.bubbleOwn, { backgroundColor: colors.messageBubbleOwn }]
              : [styles.bubbleOther, { backgroundColor: colors.messageBubbleOther, borderColor: colors.border }],
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: isOwn ? "#fff" : colors.text, fontFamily: "Inter_400Regular" },
            ]}
          >
            {message.content}
          </Text>
        </View>
        <Text style={[styles.bubbleTime, { color: colors.textTertiary, alignSelf: isOwn ? "flex-end" : "flex-start" }]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, post, patch } = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const lastMsgId = useRef(0);

  const { data: session, isLoading: sessionLoading } = useQuery<Session>({
    queryKey: ["session", sessionId],
    queryFn: () => get(`/sessions/${sessionId}`),
  });

  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ["messages", sessionId],
    queryFn: () => get(`/sessions/${sessionId}/messages`),
    onSuccess: (data) => {
      if (data.length > 0) {
        lastMsgId.current = data[data.length - 1].id;
      }
    },
  });

  useEffect(() => {
    if (!session || session.status !== "active") return;
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
    }, 2000);
    return () => clearInterval(interval);
  }, [session, sessionId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => post(`/sessions/${sessionId}/messages`, { content }),
    onMutate: async (content) => {
      const tempMsg: Message = {
        id: Date.now(),
        sessionId,
        senderId: user!.id,
        content,
        status: "sent",
        createdAt: new Date().toISOString(),
        sender: { id: user!.id, name: user!.name, username: user!.username },
      };
      queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => [...old, tempMsg]);
    },
    onSuccess: (newMsg) => {
      lastMsgId.current = newMsg.id;
      queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => {
        return old.map((m) => m.id > 1000000000 ? newMsg : m);
      });
    },
  });

  const joinMutation = useMutation({
    mutationFn: () => post(`/sessions/${sessionId}/join`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
  });

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMutation.mutate(trimmed);
  };

  const handleEndSession = () => {
    Alert.alert("End Session", "Are you sure you want to end this focus session?", [
      { text: "Cancel", style: "cancel" },
      { text: "End Session", style: "destructive", onPress: () => endMutation.mutate() },
    ]);
  };

  const isParticipant = session?.participants.some((p) => p.userId === user?.id);
  const hasJoined = session?.participants.some((p) => p.userId === user?.id && p.status === "joined");
  const isActive = session?.status === "active";
  const isCreator = session?.creatorId === user?.id;
  const canSend = isActive && (isCreator || hasJoined);

  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  if (sessionLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} />
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { paddingTop: topPad + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={[styles.navTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {session.title}
          </Text>
          <View style={styles.navMeta}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? colors.success : colors.textTertiary }]} />
            <Text style={[styles.navSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              {isActive ? "Active" : "Completed"} · {session.participants.length + 1} participants
            </Text>
          </View>
        </View>
        {isActive && isCreator && (
          <Pressable
            style={({ pressed }) => [styles.endBtn, { backgroundColor: "#FFF0F0", opacity: pressed ? 0.7 : 1 }]}
            onPress={handleEndSession}
          >
            <Text style={[styles.endBtnText, { color: colors.danger, fontFamily: "Inter_600SemiBold" }]}>End</Text>
          </Pressable>
        )}
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
            You've been invited to this session
          </Text>
          <Pressable
            style={({ pressed }) => [styles.joinBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => joinMutation.mutate()}
          >
            <Text style={[styles.joinBtnText, { fontFamily: "Inter_600SemiBold" }]}>Join</Text>
          </Pressable>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
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
              const showSender = !prev || prev.senderId !== item.senderId;
              return (
                <MessageBubble
                  message={item}
                  isOwn={isOwn}
                  showSender={showSender}
                  colors={colors}
                />
              );
            }}
            contentContainerStyle={[
              styles.messageList,
              { paddingBottom: canSend ? 0 : bottomPad + 20 },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <Feather name="message-circle" size={40} color={colors.textTertiary} />
                <Text style={[styles.emptyMessagesText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                  {canSend ? "Start the conversation" : "No messages yet"}
                </Text>
              </View>
            }
          />
        )}

        {canSend && (
          <View style={[styles.inputBar, {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: bottomPad + 8,
          }]}>
            <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <TextInput
                style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                placeholder="Type a message…"
                placeholderTextColor={colors.textTertiary}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={2000}
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: text.trim() ? colors.accent : colors.surfaceAlt, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
            >
              <Feather name="send" size={18} color={text.trim() ? "#fff" : colors.textTertiary} />
            </Pressable>
          </View>
        )}

        {!isActive && (
          <View style={[styles.endedBar, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border, paddingBottom: bottomPad + 8 }]}>
            <Feather name="archive" size={16} color={colors.textSecondary} />
            <Text style={[styles.endedText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              This session ended {session.endedAt ? formatRelative(session.endedAt) : ""}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
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
  navMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  navSub: { fontSize: 12 },
  endBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  endBtnText: { fontSize: 13 },
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
  joinBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginLeft: 12 },
  joinBtnText: { color: "#fff", fontSize: 14 },
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
  senderName: { fontSize: 11, marginLeft: 4, fontFamily: "Inter_400Regular" },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  bubbleOwn: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrapper: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
  },
  input: { fontSize: 15, lineHeight: 21 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  emptyMessages: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 60 },
  emptyMessagesText: { fontSize: 14 },
  endedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  endedText: { fontSize: 13 },
});
