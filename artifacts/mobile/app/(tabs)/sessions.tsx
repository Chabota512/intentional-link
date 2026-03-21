import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
  TextInput,
  Image,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { useLocalDiscovery } from "@/context/LocalDiscoveryContext";
import { formatRelative } from "@/utils/date";
import UserAvatar from "@/components/UserAvatar";

interface Participant {
  id: number;
  userId: number;
  status: string;
  user: { id: number; name: string; username: string; avatarUrl?: string | null; lastSeenAt?: string | null };
}

interface LastMessage {
  id: number;
  content: string;
  type: string;
  senderId: number;
  senderName: string;
  createdAt: string;
}

interface Session {
  id: number;
  title: string;
  description?: string;
  imageUrl?: string | null;
  creatorId: number;
  status: "active" | "completed";
  participants: Participant[];
  createdAt: string;
  endedAt?: string;
  lastMessage?: LastMessage | null;
  unreadCount?: number;
  messageCount?: number;
}

function getMessagePreview(msg: LastMessage | null | undefined, currentUserId: number | undefined): string {
  if (!msg) return "No messages yet";
  const prefix = msg.senderId === currentUserId ? "You: " : "";
  switch (msg.type) {
    case "image": return `${prefix}Sent a photo`;
    case "file": return `${prefix}Sent a file`;
    case "voice": return `${prefix}Voice note`;
    default: {
      const text = msg.content || "";
      return `${prefix}${text.length > 60 ? text.slice(0, 60) + "…" : text}`;
    }
  }
}

export default function SessionsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, getFileUrl } = useApi();
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState<"active" | "completed" | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [previewSession, setPreviewSession] = useState<Session | null>(null);

  const { isConnected: socketConnected, onlineUserIds } = useSocket();
  const { getPresenceStatus } = useLocalDiscovery();

  const getEffectivePresence = (userId: number, lastSeenAt?: string | null) => {
    if (onlineUserIds.has(userId)) return "online";
    return getPresenceStatus(userId, lastSeenAt);
  };

  const { data: sessions = [], isLoading, isError, isRefetching, refetch } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => get("/sessions"),
    refetchInterval: socketConnected ? 30000 : 5000,
  });

  const filtered = sessions
    .filter((s) => activeFilter === "all" || s.status === activeFilter)
    .filter((s) =>
      searchQuery.trim() === "" ||
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    );

  const totalUnread = useMemo(() => sessions.reduce((sum, s) => sum + (s.unreadCount ?? 0), 0), [sessions]);
  const activeSessions = sessions.filter((s) => s.status === "active");
  const pendingInviteIds = new Set(
    sessions
      .filter((s) =>
        s.status === "active" &&
        s.participants.some((p) => p.userId === user?.id && p.status === "invited")
      )
      .map((s) => s.id)
  );

  const onNewSession = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/session/new");
  };

  const onOpenSession = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/session/${id}`);
  };

  const toggleSearch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (searchVisible) {
      setSearchQuery("");
    }
    setSearchVisible((v) => !v);
  };

  const renderItem = ({ item }: { item: Session }) => {
    const isActive = item.status === "active";
    const isPendingInvite = pendingInviteIds.has(item.id);
    const others = item.participants.filter((p) => p.userId !== user?.id);
    const unread = item.unreadCount ?? 0;
    const preview = getMessagePreview(item.lastMessage, user?.id);
    const timeStr = item.lastMessage?.createdAt
      ? formatRelative(item.lastMessage.createdAt)
      : formatRelative(item.createdAt);

    const groupDotColor = isActive ? "#34C759" : "#94A3B8";

    const avatarUser = others.length === 1 ? others[0].user : null;
    const nameStr = others.length > 0
      ? others.map((p) => p.user.name).join(", ")
      : "Just you";

    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionCard,
          {
            backgroundColor: colors.surface,
            borderColor: isPendingInvite
              ? colors.accent + "66"
              : unread > 0
              ? colors.accent + "33"
              : colors.border,
            borderWidth: isPendingInvite || unread > 0 ? 1.5 : 1,
            opacity: pressed ? 0.92 : 1,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}
        onPress={() => onOpenSession(item.id)}
      >
        {isPendingInvite && (
          <View style={[styles.invitedBanner, { backgroundColor: colors.accent }]}>
            <Feather name="bell" size={11} color="#fff" />
            <Text style={[styles.invitedBannerText, { fontFamily: "Inter_600SemiBold" }]}>
              You're invited — tap to join
            </Text>
          </View>
        )}
        <View style={styles.sessionCardRow}>
          <Pressable
            style={{ position: "relative" }}
            onPress={(e) => {
              e.stopPropagation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setPreviewSession(item);
            }}
            hitSlop={6}
          >
            {item.imageUrl ? (
              <>
                <Image
                  source={{ uri: getFileUrl(item.imageUrl) }}
                  style={styles.sessionImage}
                />
                <View style={[styles.onlineDot, { backgroundColor: groupDotColor, borderColor: colors.surface }]} />
              </>
            ) : avatarUser ? (
              <UserAvatar
                name={avatarUser.name}
                avatarUrl={avatarUser.avatarUrl}
                size={50}
                presenceStatus={getEffectivePresence(avatarUser.id, avatarUser.lastSeenAt) as any}
                showDot={true}
              />
            ) : (
              <View style={[styles.groupAvatar, { backgroundColor: isActive ? colors.accentSoft : colors.surfaceAlt }]}>
                <Text style={[styles.groupAvatarLetter, { color: isActive ? colors.accent : colors.textSecondary, fontFamily: "Inter_700Bold" }]}>
                  {item.title.trim().charAt(0).toUpperCase()}
                </Text>
                <View style={[styles.onlineDot, { backgroundColor: groupDotColor, borderColor: colors.surface }]} />
              </View>
            )}
          </Pressable>

          <View style={styles.sessionContent}>
            <View style={styles.sessionTopRow}>
              <Text
                style={[
                  styles.sessionTitle,
                  { color: colors.text, fontFamily: unread > 0 ? "Inter_700Bold" : "Inter_600SemiBold" },
                ]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text style={[styles.sessionTime, { color: unread > 0 ? colors.accent : colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                {timeStr}
              </Text>
            </View>

            <View style={styles.sessionBottomRow}>
              <Text
                style={[
                  styles.previewText,
                  {
                    color: unread > 0 ? colors.text : colors.textSecondary,
                    fontFamily: unread > 0 ? "Inter_500Medium" : "Inter_400Regular",
                  },
                ]}
                numberOfLines={1}
              >
                {preview}
              </Text>
              {unread > 0 && (
                <View style={[styles.unreadBadge, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.unreadText, { fontFamily: "Inter_700Bold" }]}>
                    {unread > 99 ? "99+" : unread}
                  </Text>
                </View>
              )}
            </View>

            {others.length > 1 && (
              <Text style={[styles.participantsText, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
                {nameStr}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const previewOthers = previewSession?.participants.filter((p) => p.userId !== user?.id) ?? [];
  const previewAvatarUser = previewOthers.length === 1 ? previewOthers[0].user : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Chats</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            {activeSessions.length} active{totalUnread > 0 ? ` · ${totalUnread} unread` : ""}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/search" as any);
            }}
          >
            <Feather name="search" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.newBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
            onPress={onNewSession}
          >
            <Feather name="plus" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      {searchVisible && (
        <View style={[styles.searchBar, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={[styles.searchWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text, fontFamily: "Inter_400Regular" }]}
              placeholder="Search chats…"
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Feather name="x-circle" size={16} color={colors.textTertiary} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
        {(["all", "active", "completed"] as const).map((f) => (
          <Pressable
            key={f}
            style={[styles.filterBtn, activeFilter === f && { backgroundColor: colors.accentSoft }]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[
              styles.filterText,
              { color: activeFilter === f ? colors.accent : colors.textSecondary, fontFamily: "Inter_500Medium" }
            ]}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
        {searchQuery.trim() !== "" && (
          <Text style={[styles.searchResultCount, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </Text>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={36} color={colors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold", marginTop: 16 }]}>
            Could not load chats
          </Text>
          <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            Check your connection and try again.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1, marginTop: 8 }]}
            onPress={() => refetch()}
          >
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={[styles.emptyBtnText, { fontFamily: "Inter_600SemiBold" }]}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad + 80 },
            filtered.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            searchQuery.trim() !== "" ? (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
                  <Feather name="search" size={36} color={colors.textTertiary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                  No chats found
                </Text>
                <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                  No chats match "{searchQuery}"
                </Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
                  <Feather name="message-circle" size={36} color={colors.textTertiary} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                  No chats yet
                </Text>
                <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                  Start a chat for intentional, distraction-free communication.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                  onPress={onNewSession}
                >
                  <Feather name="plus" size={16} color="#fff" />
                  <Text style={[styles.emptyBtnText, { fontFamily: "Inter_600SemiBold" }]}>New Chat</Text>
                </Pressable>
              </View>
            )
          }
        />
      )}

      {/* Avatar Preview Modal */}
      <Modal
        visible={previewSession !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewSession(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPreviewSession(null)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {/* Close button */}
            <Pressable
              style={[styles.modalCloseBtn, { backgroundColor: "rgba(255,255,255,0.15)" }]}
              onPress={() => setPreviewSession(null)}
            >
              <Feather name="x" size={20} color="#fff" />
            </Pressable>

            {/* Large avatar */}
            {previewSession?.imageUrl ? (
              <Image
                source={{ uri: getFileUrl(previewSession.imageUrl) }}
                style={styles.modalAvatar}
              />
            ) : previewAvatarUser?.avatarUrl ? (
              <Image
                source={{ uri: getFileUrl(previewAvatarUser.avatarUrl) }}
                style={styles.modalAvatar}
              />
            ) : (
              <View style={[styles.modalAvatarPlaceholder, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.modalAvatarLetter, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
                  {previewSession?.title.trim().charAt(0).toUpperCase() ?? "?"}
                </Text>
              </View>
            )}

            {/* Chat name */}
            <Text style={[styles.modalTitle, { fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
              {previewSession?.title}
            </Text>

            {/* Action buttons */}
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalActionBtn, { backgroundColor: "rgba(255,255,255,0.15)", opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  setPreviewSession(null);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/session/media/${previewSession?.id}` as any);
                }}
              >
                <Feather name="image" size={24} color="#fff" />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.modalActionBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => {
                  setPreviewSession(null);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/session/${previewSession?.id}`);
                }}
              >
                <Feather name="message-circle" size={24} color="#fff" />
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 24, lineHeight: 30 },
  headerSub: { fontSize: 12, marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  newBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4BA896",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  searchBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  filterText: { fontSize: 13 },
  searchResultCount: { marginLeft: "auto", fontSize: 12 },
  list: { padding: 12, gap: 6 },
  listEmpty: { flex: 1 },
  sessionCard: {
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  invitedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  invitedBannerText: { color: "#fff", fontSize: 12 },
  sessionCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  groupAvatarLetter: {
    fontSize: 20,
    lineHeight: 24,
  },
  sessionImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
  },
  sessionContent: {
    flex: 1,
    gap: 3,
  },
  sessionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sessionTitle: { fontSize: 15, flex: 1 },
  sessionTime: { fontSize: 11 },
  sessionBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: {
    color: "#fff",
    fontSize: 11,
  },
  participantsText: {
    fontSize: 12,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyTitle: { fontSize: 20, textAlign: "center" },
  emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyBtnText: { color: "#fff", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalContent: {
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 24,
    width: "100%",
  },
  modalCloseBtn: {
    position: "absolute",
    top: -48,
    right: 24,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalAvatar: {
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  modalAvatarPlaceholder: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  modalAvatarLetter: {
    fontSize: 72,
    lineHeight: 80,
  },
  modalTitle: {
    fontSize: 22,
    color: "#fff",
    textAlign: "center",
    marginTop: 4,
  },
  modalActions: {
    flexDirection: "row",
    gap: 24,
    marginTop: 8,
  },
  modalActionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
