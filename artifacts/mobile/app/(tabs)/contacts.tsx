import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { isOnline, formatLastSeen } from "@/utils/lastSeen";
import { confirmAction } from "@/utils/confirm";

interface ContactUser {
  id: number;
  name: string;
  username: string;
  lastSeenAt?: string | null;
}

interface Contact {
  id: number;
  userId: number;
  contactUser: ContactUser;
  createdAt: string;
}

export default function ContactsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, del } = useApi();
  const queryClient = useQueryClient();

  const { data: contacts = [], isLoading, isRefetching, refetch } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
    refetchInterval: 30_000,
  });

  const removeMutation = useMutation({
    mutationFn: (contactId: number) => del(`/contacts/${contactId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to remove contact. Please try again.");
    },
  });

  const handleRemove = (contact: Contact) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    confirmAction(
      "Remove Contact",
      `Remove ${contact.contactUser.name} from your contacts?`,
      "Remove",
      () => removeMutation.mutate(contact.id)
    );
  };

  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const onlineCount = contacts.filter(c => isOnline(c.contactUser.lastSeenAt)).length;

  const renderItem = ({ item }: { item: Contact }) => {
    const online = isOnline(item.contactUser.lastSeenAt);
    return (
      <View style={[styles.contactCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ position: "relative" }}>
          <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
            <Text style={[styles.avatarText, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]}>
              {item.contactUser.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          {online && (
            <View style={[styles.onlineDot, { backgroundColor: colors.success, borderColor: colors.surface }]} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.contactName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
            {item.contactUser.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Text style={[styles.contactUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              @{item.contactUser.username}
            </Text>
            <Text style={[styles.contactUsername, { color: colors.textTertiary }]}>·</Text>
            <Text style={[styles.contactUsername, { color: online ? colors.success : colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
              {online ? "Online" : formatLastSeen(item.contactUser.lastSeenAt)}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => handleRemove(item)}
          style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="user-minus" size={18} color={colors.danger} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Contacts</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            {contacts.length} contacts{onlineCount > 0 ? ` · ${onlineCount} online` : ""}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/contacts/add");
          }}
        >
          <Feather name="user-plus" size={18} color="#fff" />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad + 80 },
            contacts.length === 0 && styles.listEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Feather name="users" size={36} color={colors.textTertiary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                No contacts yet
              </Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                Add trusted contacts to invite them to focus sessions.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => router.push("/contacts/add")}
              >
                <Feather name="user-plus" size={16} color="#fff" />
                <Text style={[styles.emptyBtnText, { fontFamily: "Inter_600SemiBold" }]}>Add Contact</Text>
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
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 24, lineHeight: 30 },
  headerSub: { fontSize: 12, marginTop: 1 },
  addBtn: {
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
  list: { padding: 12, gap: 8 },
  listEmpty: { flex: 1 },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  avatarText: { fontSize: 18 },
  contactName: { fontSize: 15 },
  contactUsername: { fontSize: 13 },
  removeBtn: { padding: 8 },
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
