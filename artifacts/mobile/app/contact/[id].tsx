import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { formatRelative } from "@/utils/date";
import { isOnline } from "@/utils/lastSeen";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface Participant {
  id: number;
  userId: number;
  status: string;
  user: { id: number; name: string; username: string };
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
  creator?: { id: number; name: string; username: string; avatarUrl?: string | null; lastSeenAt?: string | null };
}

interface ContactUser {
  id: number;
  name: string;
  username: string;
  avatarUrl?: string | null;
  lastSeenAt?: string | null;
}

interface Contact {
  id: number;
  contactUser: ContactUser;
}

function resolveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${BASE_URL}${url}`;
}

export default function ContactChatsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get } = useApi();
  const { user: me } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const contactUserId = parseInt(id, 10);

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
  });

  const { data: sessions = [], isLoading, isRefetching, refetch } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => get("/sessions"),
    refetchInterval: 10000,
  });

  const contact = contacts.find((c) => c.contactUser.id === contactUserId)?.contactUser;

  const sharedSessions = sessions
    .filter((s) => {
      const contactIsCreator = s.creatorId === contactUserId;
      const contactIsParticipant = s.participants.some((p) => p.userId === contactUserId);
      return contactIsCreator || contactIsParticipant;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const renderSession = ({ item }: { item: Session }) => {
    const isActive = item.status === "active";
    const isPending = item.participants.some((p) => p.userId === me?.id && p.status === "invited");

    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: isPending
              ? colors.accent + "66"
              : isActive
              ? colors.accent + "33"
              : colors.border,
            borderWidth: isActive || isPending ? 1.5 : 1,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/session/${item.id}`);
        }}
      >
        {isPending && (
          <View style={[styles.invitedBanner, { backgroundColor: colors.accent }]}>
            <Feather name="bell" size={11} color="#fff" />
            <Text style={[styles.invitedBannerText, { fontFamily: "Inter_600SemiBold" }]}>
              You're invited — tap to join
            </Text>
          </View>
        )}
        <View style={styles.cardTop}>
          <View style={[styles.iconBg, { backgroundColor: isActive ? colors.accentSoft : colors.surfaceAlt, overflow: "hidden" }]}>
            {resolveUrl(item.imageUrl) ? (
              <Image source={{ uri: resolveUrl(item.imageUrl)! }} style={{ width: 40, height: 40, borderRadius: 12 }} resizeMode="cover" />
            ) : (
              <Feather name={isActive ? "zap" : "archive"} size={18} color={isActive ? colors.accent : colors.textSecondary} />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.title, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.sub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
              {item.participants.length + 1} participant{item.participants.length !== 0 ? "s" : ""}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            {isActive && <View style={[styles.activeDot, { backgroundColor: colors.success }]} />}
            <Text style={[styles.time, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
              {formatRelative(item.createdAt)}
            </Text>
          </View>
        </View>
        {item.description ? (
          <Text style={[styles.desc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <View style={[styles.pill, { backgroundColor: isActive ? colors.accentSoft : colors.surfaceAlt }]}>
            <Text style={[styles.pillText, { color: isActive ? colors.accent : colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
              {isActive ? "Active" : "Completed"}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>

        {contact ? (
          <View style={styles.headerContact}>
            <UserAvatar
              name={contact.name}
              avatarUrl={contact.avatarUrl}
              size={36}
              isOnline={isOnline(contact.lastSeenAt)}
              showDot
            />
            <View>
              <Text style={[styles.headerName, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
                {contact.name}
              </Text>
              <Text style={[styles.headerSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                {sharedSessions.length} shared chat{sharedSessions.length !== 1 ? "s" : ""}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={[styles.headerName, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
            Chats
          </Text>
        )}

        <View style={{ width: 36 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={sharedSessions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderSession}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad + 40 },
            sharedSessions.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Feather name="message-circle" size={36} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                No shared chats yet
              </Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                {contact ? `You haven't had any chats with ${contact.name} yet.` : "No shared chats found."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerContact: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, marginHorizontal: 8 },
  headerName: { fontSize: 17 },
  headerSub: { fontSize: 12, marginTop: 1 },
  list: { padding: 12, gap: 10 },
  listEmpty: { flex: 1 },
  card: { borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  invitedBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7 },
  invitedBannerText: { color: "#fff", fontSize: 12 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, paddingBottom: 6 },
  iconBg: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15 },
  sub: { fontSize: 13 },
  time: { fontSize: 11 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  desc: { fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 6 },
  footer: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillText: { fontSize: 11 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyTitle: { fontSize: 20, textAlign: "center" },
  emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
