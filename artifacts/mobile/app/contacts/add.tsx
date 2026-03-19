import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/context/AuthContext";
import UserAvatar from "@/components/UserAvatar";

interface User {
  id: number;
  name: string;
  username: string;
  avatarUrl?: string | null;
}

interface Contact {
  id: number;
  contactUser: User;
}

interface OutgoingRequest {
  id: number;
  recipientId: number;
  recipientName: string;
  recipientUsername: string;
}

export default function AddContactScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, post, del } = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<Set<number>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: existingContacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
  });

  const { data: contactRequests } = useQuery<{ incoming: any[]; outgoing: OutgoingRequest[] }>({
    queryKey: ["contactRequests"],
    queryFn: () => get("/contacts/requests"),
  });

  const existingContactUserIds = new Set(existingContacts.map((c) => c.contactUser.id));
  const outgoingRequestIds = new Set((contactRequests?.outgoing ?? []).map((r) => r.recipientId));

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setSearchError(null); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const data = await get(`/users/search?q=${encodeURIComponent(q)}`);
        setResults(data.filter((u: User) => u.id !== user?.id));
      } catch (e: any) {
        setSearchError(e.message || "Search failed. Please try again.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  useEffect(() => {
    search(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const sendRequestMutation = useMutation({
    mutationFn: (contactUserId: number) => post("/contacts", { contactUserId }),
    onSuccess: (_, contactUserId) => {
      setRequestedIds(prev => new Set([...prev, contactUserId]));
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to send request. Please try again.");
    },
  });

  const cancelRequestMutation = useMutation({
    mutationFn: (requestId: number) => del(`/contacts/${requestId}/cancel`),
    onSuccess: (_, requestId) => {
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      const outgoingReq = contactRequests?.outgoing.find(r => r.id === requestId);
      if (outgoingReq) {
        setRequestedIds(prev => {
          const next = new Set(prev);
          next.delete(outgoingReq.recipientId);
          return next;
        });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to cancel request.");
    },
  });

  const renderUser = ({ item }: { item: User }) => {
    const isContact = existingContactUserIds.has(item.id);
    const outgoingReq = (contactRequests?.outgoing ?? []).find(r => r.recipientId === item.id);
    const hasPendingRequest = outgoingRequestIds.has(item.id) || requestedIds.has(item.id);
    const justRequested = requestedIds.has(item.id) && !outgoingReq;

    return (
      <View style={[styles.userCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <UserAvatar name={item.name} avatarUrl={item.avatarUrl} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.userName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>{item.name}</Text>
          <Text style={[styles.userUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            @{item.username}
          </Text>
        </View>

        {isContact ? (
          <View style={[styles.statusTag, { backgroundColor: colors.surfaceAlt }]}>
            <Feather name="check" size={13} color={colors.textSecondary} />
            <Text style={[styles.statusTagText, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
              Contact
            </Text>
          </View>
        ) : hasPendingRequest || justRequested ? (
          <Pressable
            style={({ pressed }) => [styles.pendingBtn, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
            onPress={() => {
              if (outgoingReq) {
                cancelRequestMutation.mutate(outgoingReq.id);
              }
            }}
            disabled={justRequested || cancelRequestMutation.isPending}
          >
            <Feather name="clock" size={13} color={colors.textSecondary} />
            <Text style={[styles.statusTagText, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
              {outgoingReq ? "Pending · Cancel" : "Requested"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              { backgroundColor: colors.accent, opacity: pressed || sendRequestMutation.isPending ? 0.7 : 1 },
            ]}
            onPress={() => sendRequestMutation.mutate(item.id)}
            disabled={sendRequestMutation.isPending}
          >
            <Feather name="user-plus" size={16} color="#fff" />
          </Pressable>
        )}
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
          Send Contact Request
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Feather name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text, fontFamily: "Inter_400Regular" }]}
            placeholder="Search by username or name…"
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching
            ? <ActivityIndicator size="small" color={colors.accent} />
            : query.length > 0
            ? (
              <Pressable onPress={() => setQuery("")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Feather name="x-circle" size={16} color={colors.textTertiary} />
              </Pressable>
            )
            : null
          }
        </View>
      </View>

      <View style={[styles.hintBanner, { backgroundColor: colors.accentSoft }]}>
        <Feather name="info" size={14} color={colors.accent} />
        <Text style={[styles.hintText, { color: colors.accent, fontFamily: "Inter_400Regular" }]}>
          They must accept your request before becoming a contact.
        </Text>
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
          searchError ? (
            <View style={styles.emptyState}>
              <Feather name="alert-circle" size={40} color={colors.danger} />
              <Text style={[styles.emptyText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                {searchError}
              </Text>
            </View>
          ) : query.length > 0 && !searching ? (
            <View style={styles.emptyState}>
              <Feather name="user-x" size={40} color={colors.textTertiary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                No users found for "{query}"
              </Text>
            </View>
          ) : query.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="users" size={40} color={colors.textTertiary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                Search for people by username or name
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
  hintBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18 },
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
  statusTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pendingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusTagText: { fontSize: 12 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 },
  emptyText: { fontSize: 14, textAlign: "center", paddingHorizontal: 30 },
});
