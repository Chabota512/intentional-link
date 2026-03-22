import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { formatRelative } from "@/utils/date";
import UserAvatar from "@/components/UserAvatar";

interface SearchResult {
  id: number;
  content: string;
  type: string;
  senderId: number;
  sessionId: number;
  createdAt: string;
  sender: { id: number; name: string; username: string; avatarUrl?: string | null };
  session: { id: number; title: string };
}

export default function SearchScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get } = useApi();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(text.trim());
    }, 400);
  }, []);

  const { data: results = [], isLoading, isFetching } = useQuery<SearchResult[]>({
    queryKey: ["messageSearch", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery) return [];
      const res = await get(`/messages/search?q=${encodeURIComponent(debouncedQuery)}&limit=30`);
      return res.results ?? [];
    },
    enabled: debouncedQuery.length >= 2,
  });

  const grouped = React.useMemo(() => {
    const map = new Map<number, { session: { id: number; title: string }; messages: SearchResult[] }>();
    for (const r of results) {
      if (!map.has(r.sessionId)) {
        map.set(r.sessionId, { session: r.session, messages: [] });
      }
      map.get(r.sessionId)!.messages.push(r);
    }
    return Array.from(map.values());
  }, [results]);

  const topPad = Math.max(insets.top, 20) + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const renderResult = ({ item }: { item: SearchResult }) => {
    const highlighted = highlightMatch(item.content, debouncedQuery);
    return (
      <Pressable
        style={({ pressed }) => [styles.resultCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/session/${item.sessionId}`);
        }}
      >
        <UserAvatar name={item.sender.name} avatarUrl={item.sender.avatarUrl} size={36} />
        <View style={{ flex: 1 }}>
          <View style={styles.resultHeader}>
            <Text style={[styles.senderName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
              {item.sender.name}
            </Text>
            <Text style={[styles.resultTime, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
              {formatRelative(item.createdAt)}
            </Text>
          </View>
          <Text style={[styles.resultContent, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
            {highlighted}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={[styles.searchInputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text, fontFamily: "Inter_400Regular" }]}
            placeholder="Search messages…"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={handleSearch}
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setDebouncedQuery(""); }}>
              <Feather name="x-circle" size={16} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>
      </View>

      {debouncedQuery.length < 2 ? (
        <View style={styles.center}>
          <Feather name="search" size={40} color={colors.textTertiary} />
          <Text style={[styles.hintText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            Type at least 2 characters to search
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.center}>
          <Feather name="inbox" size={40} color={colors.textTertiary} />
          <Text style={[styles.hintText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            No messages found for "{debouncedQuery}"
          </Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => String(item.session.id)}
          contentContainerStyle={{ padding: 12, paddingBottom: bottomPad + 20 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: group }) => (
            <View style={{ marginBottom: 16 }}>
              <Pressable
                style={styles.sessionHeader}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/session/${group.session.id}`);
                }}
              >
                <View style={[styles.sessionIcon, { backgroundColor: colors.accentSoft }]}>
                  <Feather name="zap" size={14} color={colors.accent} />
                </View>
                <Text style={[styles.sessionName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                  {group.session.title}
                </Text>
                <Text style={[styles.matchCount, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                  {group.messages.length} match{group.messages.length !== 1 ? "es" : ""}
                </Text>
                <Feather name="chevron-right" size={14} color={colors.textTertiary} />
              </Pressable>
              {group.messages.map((msg) => (
                <View key={msg.id}>{renderResult({ item: msg })}</View>
              ))}
            </View>
          )}
          ListHeaderComponent={
            <Text style={[styles.totalCount, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
              {results.length} result{results.length !== 1 ? "s" : ""} in {grouped.length} chat{grouped.length !== 1 ? "s" : ""}
            </Text>
          }
        />
      )}
    </View>
  );
}

function highlightMatch(text: string, query: string): string {
  if (!query || !text) return text;
  return text;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  searchInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  hintText: { fontSize: 14, textAlign: "center" },
  totalCount: { fontSize: 12, marginBottom: 12, paddingHorizontal: 4 },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sessionIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionName: { flex: 1, fontSize: 14 },
  matchCount: { fontSize: 12 },
  resultCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  senderName: { fontSize: 13, flex: 1 },
  resultTime: { fontSize: 11 },
  resultContent: { fontSize: 13, lineHeight: 18, marginTop: 2 },
});
