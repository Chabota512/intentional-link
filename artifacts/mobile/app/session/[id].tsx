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
  Modal,
  ScrollView,
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
          {isOwn && (
            <Feather
              name={message.status === "sent" ? "check" : "check"}
              size={10}
              color={colors.textTertiary}
            />
          )}
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
  const { get, post, patch } = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const lastMsgId = useRef(0);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("participants");

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to invite");
    },
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
