import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import { formatRelative } from "@/utils/date";

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
  creatorId: number;
  status: "active" | "completed";
  participants: Participant[];
  createdAt: string;
  endedAt?: string;
}

export default function SessionsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get } = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<"active" | "completed" | "all">("all");

  const { data: sessions = [], isLoading, refetch } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => get("/sessions"),
    refetchInterval: 5000,
  });

  const filtered = activeFilter === "all"
    ? sessions
    : sessions.filter((s) => s.status === activeFilter);

  const activeSessions = sessions.filter((s) => s.status === "active");

  const onNewSession = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/session/new");
  };

  const onOpenSession = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/session/${id}`);
  };

  const renderItem = ({ item }: { item: Session }) => {
    const isActive = item.status === "active";
    const others = item.participants.filter((p) => p.userId !== user?.id);
    const nameStr = others.length > 0
      ? others.map((p) => p.user.name).join(", ")
      : "Just you";

    return (
      <Pressable
        style={({ pressed }) => [
          styles.sessionCard,
          {
            backgroundColor: colors.surface,
            borderColor: isActive ? colors.accent + "33" : colors.border,
            borderWidth: isActive ? 1.5 : 1,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}
        onPress={() => onOpenSession(item.id)}
      >
        <View style={styles.sessionCardTop}>
          <View style={[styles.sessionIconBg, { backgroundColor: isActive ? colors.accentSoft : colors.surfaceAlt }]}>
            <Feather name={isActive ? "zap" : "archive"} size={18} color={isActive ? colors.accent : colors.textSecondary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.sessionTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.sessionParticipants, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
              {nameStr}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            {isActive && (
              <View style={[styles.activeDot, { backgroundColor: colors.success }]} />
            )}
            <Text style={[styles.sessionTime, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
              {formatRelative(item.createdAt)}
            </Text>
          </View>
        </View>
        {item.description ? (
          <Text style={[styles.sessionDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.sessionFooter}>
          <View style={[styles.statusPill, { backgroundColor: isActive ? colors.accentSoft : colors.surfaceAlt }]}>
            <Text style={[styles.statusPillText, { color: isActive ? colors.accent : colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
              {isActive ? "Active" : "Completed"}
            </Text>
          </View>
          <Text style={[styles.participantCount, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
            {item.participants.length + 1} participant{item.participants.length !== 0 ? "s" : ""}
          </Text>
        </View>
      </Pressable>
    );
  };

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 20, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Focus Sessions</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            {activeSessions.length} active
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.newBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
          onPress={onNewSession}
        >
          <Feather name="plus" size={20} color="#fff" />
        </Pressable>
      </View>

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
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
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
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Feather name="message-circle" size={36} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                No sessions yet
              </Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                Start a focus session for intentional, distraction-free communication.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                onPress={onNewSession}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={[styles.emptyBtnText, { fontFamily: "Inter_600SemiBold" }]}>New Session</Text>
              </Pressable>
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
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 28, lineHeight: 34 },
  headerSub: { fontSize: 13, marginTop: 2 },
  newBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4F6EF7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  filterRow: {
    flexDirection: "row",
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
  list: { padding: 16, gap: 12 },
  listEmpty: { flex: 1 },
  sessionCard: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  sessionCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  sessionIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionTitle: { fontSize: 15 },
  sessionParticipants: { fontSize: 13 },
  sessionTime: { fontSize: 11 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  sessionDesc: { fontSize: 13, lineHeight: 18 },
  sessionFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusPillText: { fontSize: 11 },
  participantCount: { fontSize: 12 },
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
});
