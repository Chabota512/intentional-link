import React, { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import * as SMS from "expo-sms";
import * as Linking from "expo-linking";
import { useTheme } from "@/hooks/useTheme";
import { useApi, ApiError } from "@/hooks/useApi";
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
  creator?: { id: number; name: string; username: string } | null;
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
        <View style={[styles.bubbleMeta, { alignSelf: isOwn ? "flex-end" : "flex-start" }]}>
          <Text style={[styles.bubbleTime, { color: colors.textTertiary }]}>
            {formatTime(message.createdAt)}
          </Text>
          {isOwn && message.status === "delivered" ? (
            <View style={{ flexDirection: "row" }}>
              <Feather name="check" size={10} color={colors.accent} style={{ marginRight: -4 }} />
              <Feather name="check" size={10} color={colors.accent} />
            </View>
          ) : isOwn ? (
            <Feather name="check" size={10} color={colors.textTertiary} />
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

type SheetView = "participants" | "invite";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, post, patch, del } = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const lastMsgId = useRef(0);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("participants");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const consecutivePollErrors = useRef(0);

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
      Alert.alert("Could not join", e.message || "Unable to join this session.");
    },
  });

  const shareSessionLink = async () => {
    const link = Linking.createURL(`session/${sessionId}`);
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

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
    enabled: sheetVisible && sheetView === "invite",
  });

  useEffect(() => {
    if (!session || session.status !== "active") return;
    const interval = setInterval(async () => {
      try {
        const newMsgs = await get(`/sessions/${sessionId}/messages/poll?since=${lastMsgId.current}`);
        consecutivePollErrors.current = 0;
        setPollFailed(false);
        if (newMsgs.length > 0) {
          lastMsgId.current = newMsgs[newMsgs.length - 1].id;
          queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => {
            const existingIds = new Set(old.map((m) => m.id));
            const fresh = newMsgs.filter((m: Message) => !existingIds.has(m.id));
            return fresh.length > 0 ? [...old, ...fresh] : old;
          });
        }
      } catch {
        consecutivePollErrors.current += 1;
        if (consecutivePollErrors.current >= 3) setPollFailed(true);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [session, sessionId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const tempIdRef = useRef<number>(0);

  const sendMutation = useMutation({
    mutationFn: (content: string) => post(`/sessions/${sessionId}/messages`, { content }),
    onMutate: async (content) => {
      const tempId = -(Date.now());
      tempIdRef.current = tempId;
      const tempMsg: Message = {
        id: tempId,
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
        return old.map((m) => m.id === tempIdRef.current ? newMsg : m);
      });
    },
    onError: () => {
      queryClient.setQueryData(["messages", sessionId], (old: Message[] = []) => {
        return old.filter((m) => m.id !== tempIdRef.current);
      });
      Alert.alert("Failed to send", "Your message could not be sent. Please try again.");
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
      Alert.alert("Error", e.message || "Failed to leave session");
    },
  });

  const loadOlderMessages = async () => {
    if (loadingOlder || messages.length === 0) return;
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
  };

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

  const handleLeaveSession = () => {
    Alert.alert("Leave Session", "Are you sure you want to leave this session?", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => leaveMutation.mutate() },
    ]);
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
        <View style={[styles.navBar, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.navCenter}>
            <Text style={[styles.navTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {sessionPreview?.title ?? "Session"}
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
                      This session has already ended.
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
          <Pressable style={styles.navMeta} onPress={openParticipants}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? colors.success : colors.textTertiary }]} />
            <Text style={[styles.navSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              {isActive ? "Active" : "Completed"} · {totalPeople} participant{totalPeople !== 1 ? "s" : ""}
            </Text>
            <Feather name="chevron-right" size={12} color={colors.textTertiary} />
          </Pressable>
        </View>
        <View style={styles.navActions}>
          <Pressable
            style={({ pressed }) => [styles.navIconBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={openParticipants}
          >
            <Feather name="users" size={20} color={colors.textSecondary} />
          </Pressable>
          {isActive && isCreator && (
            <>
              <Pressable
                style={({ pressed }) => [styles.navIconBtn, { opacity: pressed ? 0.6 : 1 }]}
                onPress={openInvite}
              >
                <Feather name="user-plus" size={20} color={colors.accent} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.endBtn, { backgroundColor: "#FFF0F0", opacity: pressed ? 0.7 : 1 }]}
                onPress={handleEndSession}
              >
                <Text style={[styles.endBtnText, { color: colors.danger, fontFamily: "Inter_600SemiBold" }]}>End</Text>
              </Pressable>
            </>
          )}
          {isActive && !isCreator && hasJoined && (
            <Pressable
              style={({ pressed }) => [styles.endBtn, { backgroundColor: "#FFF0F0", opacity: pressed ? 0.7 : 1 }]}
              onPress={handleLeaveSession}
            >
              <Text style={[styles.endBtnText, { color: colors.danger, fontFamily: "Inter_600SemiBold" }]}>Leave</Text>
            </Pressable>
          )}
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
        {pollFailed && isActive && (
          <View style={[styles.pollErrorBanner, { backgroundColor: "#FFF3CD", borderBottomColor: "#FFEAA7" }]}>
            <Feather name="wifi-off" size={14} color="#856404" />
            <Text style={[styles.pollErrorText, { color: "#856404", fontFamily: "Inter_500Medium" }]}>
              Connection issues — trying to reconnect…
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
              <View style={[styles.participantRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.participantAvatar, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.participantAvatarText, { fontFamily: "Inter_700Bold" }]}>
                    {(session.creator?.name ?? (isCreator ? user?.name : null) ?? "?").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.participantName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                    {session.creator?.name ?? (isCreator ? user?.name : "Unknown")}
                  </Text>
                  <Text style={[styles.participantUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    @{session.creator?.username ?? (isCreator ? user?.username : "unknown")}
                  </Text>
                </View>
                <View style={[styles.rolePill, { backgroundColor: colors.accentSoft }]}>
                  <Text style={[styles.rolePillText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>Creator</Text>
                </View>
              </View>

              {session.participants.filter(p => p.userId !== session.creatorId).map((p) => (
                <View key={p.id} style={[styles.participantRow, { borderBottomColor: colors.border }]}>
                  <View style={[styles.participantAvatar, { backgroundColor: colors.accentSoft }]}>
                    <Text style={[styles.participantAvatarText, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
                      {p.user.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.participantName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                      {p.user.name}
                    </Text>
                    <Text style={[styles.participantUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                      @{p.user.username}
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
              ))}

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
            <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
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
                    All your contacts are already in this session
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
  bubbleMeta: { flexDirection: "row", alignItems: "center", gap: 3 },
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
  sheetScroll: { padding: 16, gap: 0 },
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
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
});
