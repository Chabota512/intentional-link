import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";

interface User {
  id: number;
  name: string;
  username: string;
}

export default function AddContactScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, post } = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const search = async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const data = await get(`/users/search?q=${encodeURIComponent(q)}`);
      setResults(data.filter((u: User) => u.id !== user?.id));
    } catch {}
    finally { setSearching(false); }
  };

  const addMutation = useMutation({
    mutationFn: (contactUserId: number) => post("/contacts", { contactUserId }),
    onSuccess: (_, contactUserId) => {
      setAddedIds(prev => new Set([...prev, contactUserId]));
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const renderUser = ({ item }: { item: User }) => {
    const isAdded = addedIds.has(item.id);
    return (
      <View style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.avatarText, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.userName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>{item.name}</Text>
          <Text style={[styles.userUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            @{item.username}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: isAdded ? colors.surfaceAlt : colors.accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          onPress={() => {
            if (!isAdded) addMutation.mutate(item.id);
          }}
          disabled={isAdded || addMutation.isPending}
        >
          <Feather name={isAdded ? "check" : "user-plus"} size={16} color={isAdded ? colors.textSecondary : "#fff"} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.dismiss()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Feather name="x" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
          Add Contact
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text, fontFamily: "Inter_400Regular" }]}
            placeholder="Search by username…"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={(t) => { setQuery(t); search(t); }}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={colors.accent} />}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderUser}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 20 },
          results.length === 0 && styles.listEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          query.length > 0 && !searching ? (
            <View style={styles.emptyState}>
              <Feather name="user-x" size={40} color={colors.textTertiary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                No users found for "{query}"
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16 },
  searchRow: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 15 },
  list: { padding: 16, gap: 10 },
  listEmpty: { flex: 1 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18 },
  userName: { fontSize: 15 },
  userUsername: { fontSize: 13, marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 14, textAlign: "center" },
});
