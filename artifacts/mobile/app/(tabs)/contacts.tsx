import React, { useState, useRef } from "react";
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
  ScrollView,
  Image,
  Modal,
  useWindowDimensions,
} from "react-native";
import UserAvatar from "@/components/UserAvatar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { isOnline, formatLastSeen } from "@/utils/lastSeen";
import { confirmAction } from "@/utils/confirm";
import { useLocalDiscovery } from "@/context/LocalDiscoveryContext";

interface ContactUser {
  id: number;
  name: string;
  username: string;
  avatarUrl?: string | null;
  lastSeenAt?: string | null;
}

interface Contact {
  id: number;
  userId: number;
  contactUser: ContactUser;
  createdAt: string;
}

interface IncomingRequest {
  id: number;
  senderId: number;
  senderName: string;
  senderUsername: string;
  senderAvatarUrl?: string | null;
  createdAt: string;
}

interface OutgoingRequest {
  id: number;
  recipientId: number;
  recipientName: string;
  recipientUsername: string;
  recipientAvatarUrl?: string | null;
  createdAt: string;
}

interface ContactRequests {
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
}

type Tab = "contacts" | "requests";

export default function ContactsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, post, del } = useApi();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("contacts");
  const [avatarPreview, setAvatarPreview] = useState<ContactUser | null>(null);
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);

  const { data: contacts = [], isLoading: contactsLoading, isRefetching, refetch } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
    refetchInterval: 30_000,
  });

  const { data: requests, isLoading: requestsLoading, refetch: refetchRequests } = useQuery<ContactRequests>({
    queryKey: ["contactRequests"],
    queryFn: () => get("/contacts/requests"),
    refetchInterval: 15_000,
  });

  const incomingCount = requests?.incoming.length ?? 0;
  const contactsCount = contacts.length;

  const acceptMutation = useMutation({
    mutationFn: (requestId: number) => post(`/contacts/requests/${requestId}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to accept request.");
    },
  });

  const declineMutation = useMutation({
    mutationFn: (requestId: number) => post(`/contacts/requests/${requestId}/decline`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to decline request.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: number) => del(`/contacts/${requestId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contactRequests"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to cancel request.");
    },
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

  const { getPresenceStatus } = useLocalDiscovery();

  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const localCount = contacts.filter(c => getPresenceStatus(c.contactUser.id, c.contactUser.lastSeenAt) === "local").length;
  const onlineCount = contacts.filter(c => getPresenceStatus(c.contactUser.id, c.contactUser.lastSeenAt) !== "offline").length;

  const presenceLabel = (status: "local" | "online" | "offline") => {
    if (status === "local") return { text: "On this network", color: "#FF6B9D" };
    if (status === "online") return { text: "Online", color: colors.success };
    return { text: formatLastSeen(undefined), color: colors.textTertiary };
  };

  const renderContact = ({ item }: { item: Contact }) => {
    const status = getPresenceStatus(item.contactUser.id, item.contactUser.lastSeenAt);
    const label = status === "offline"
      ? { text: formatLastSeen(item.contactUser.lastSeenAt), color: colors.textTertiary }
      : presenceLabel(status);
    return (
      <Pressable
        style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push(`/contact/${item.contactUser.id}`);
        }}
      >
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setAvatarPreview(item.contactUser);
          }}
          hitSlop={4}
        >
          <UserAvatar
            name={item.contactUser.name}
            avatarUrl={item.contactUser.avatarUrl}
            size={44}
            presenceStatus={status}
            showDot={true}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.contactName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
            {item.contactUser.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Text style={[styles.contactSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              @{item.contactUser.username}
            </Text>
            <Text style={[styles.contactSub, { color: colors.textTertiary }]}>·</Text>
            <Text style={[styles.contactSub, { color: label.color, fontFamily: "Inter_400Regular" }]}>
              {label.text}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
          <Pressable
            onPress={(e) => { e.stopPropagation(); handleRemove(item); }}
            style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
          >
            <Feather name="user-minus" size={18} color={colors.danger} />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const renderIncoming = ({ item }: { item: IncomingRequest }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.accent + "44", borderWidth: 1.5 }]}>
      <UserAvatar name={item.senderName} avatarUrl={item.senderAvatarUrl} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.contactName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
          {item.senderName}
        </Text>
        <Text style={[styles.contactSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
          @{item.senderUsername} wants to connect
        </Text>
      </View>
      <View style={styles.requestActions}>
        <Pressable
          style={({ pressed }) => [styles.declineBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => confirmAction("Decline Request", `Decline the contact request from ${item.senderName}?`, "Decline", () => declineMutation.mutate(item.id))}
          disabled={declineMutation.isPending}
        >
          <Text style={[styles.declineBtnText, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
            Decline
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.acceptBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
          onPress={() => acceptMutation.mutate(item.id)}
          disabled={acceptMutation.isPending}
        >
          {acceptMutation.isPending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={[styles.acceptBtnText, { fontFamily: "Inter_600SemiBold" }]}>Accept</Text>
          }
        </Pressable>
      </View>
    </View>
  );

  const renderOutgoing = ({ item }: { item: OutgoingRequest }) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <UserAvatar name={item.recipientName} avatarUrl={item.recipientAvatarUrl} size={44} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.contactName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
          {item.recipientName}
        </Text>
        <Text style={[styles.contactSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
          @{item.recipientUsername} · Awaiting response
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.cancelBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        onPress={() => confirmAction("Cancel Request", `Cancel your contact request to ${item.recipientName}?`, "Cancel Request", () => cancelMutation.mutate(item.id), false)}
        disabled={cancelMutation.isPending}
      >
        <Text style={[styles.cancelBtnText, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Contacts</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            {contacts.length} contacts{localCount > 0 ? ` · ${localCount} nearby` : onlineCount > 0 ? ` · ${onlineCount} online` : ""}
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

      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        <Pressable
          style={[styles.tab, activeTab === "contacts" && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
          onPress={() => {
            setActiveTab("contacts");
            pagerRef.current?.scrollTo({ x: 0, animated: true });
          }}
        >
          <View style={styles.tabInner}>
            <Text style={[styles.tabText, { color: activeTab === "contacts" ? colors.accent : colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
              Contacts
            </Text>
            {contactsCount > 0 && (
              <View style={[styles.badge, { backgroundColor: activeTab === "contacts" ? colors.accent : colors.textTertiary }]}>
                <Text style={[styles.badgeText, { fontFamily: "Inter_700Bold" }]}>{contactsCount}</Text>
              </View>
            )}
          </View>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "requests" && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
          onPress={() => {
            setActiveTab("requests");
            pagerRef.current?.scrollTo({ x: width, animated: true });
          }}
        >
          <View style={styles.tabInner}>
            <Text style={[styles.tabText, { color: activeTab === "requests" ? colors.accent : colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
              Requests
            </Text>
            {incomingCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                <Text style={[styles.badgeText, { fontFamily: "Inter_700Bold" }]}>{incomingCount}</Text>
              </View>
            )}
          </View>
        </Pressable>
      </View>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const page = Math.round(e.nativeEvent.contentOffset.x / width);
          setActiveTab(page === 0 ? "contacts" : "requests");
        }}
        style={{ flex: 1 }}
      >
        {/* Contacts page */}
        <View style={{ width }}>
          {contactsLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <FlatList
              data={contacts}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderContact}
              contentContainerStyle={[
                styles.list,
                { paddingBottom: bottomPad + 80 },
                contacts.length === 0 && styles.listEmpty,
              ]}
              showsVerticalScrollIndicator={false}
              scrollEnabled={true}
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
                    Send a request to someone — they'll need to accept before you're connected.
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => router.push("/contacts/add")}
                  >
                    <Feather name="user-plus" size={16} color="#fff" />
                    <Text style={[styles.emptyBtnText, { fontFamily: "Inter_600SemiBold" }]}>Find People</Text>
                  </Pressable>
                </View>
              }
            />
          )}
        </View>

        {/* Requests page */}
        <View style={{ width }}>
          {requestsLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 80 }]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={false}
                  onRefresh={() => refetchRequests()}
                  tintColor={colors.accent}
                />
              }
            >
              {(requests?.incoming.length ?? 0) > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
                    INCOMING
                  </Text>
                  {(requests?.incoming ?? []).map((item) => (
                    <View key={item.id} style={{ marginBottom: 8 }}>
                      {renderIncoming({ item })}
                    </View>
                  ))}
                </>
              )}

              {(requests?.outgoing.length ?? 0) > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold", marginTop: 16 }]}>
                    SENT
                  </Text>
                  {(requests?.outgoing ?? []).map((item) => (
                    <View key={item.id} style={{ marginBottom: 8 }}>
                      {renderOutgoing({ item })}
                    </View>
                  ))}
                </>
              )}

              {(requests?.incoming.length ?? 0) === 0 && (requests?.outgoing.length ?? 0) === 0 && (
                <View style={[styles.emptyState, { marginTop: 60 }]}>
                  <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
                    <Feather name="bell" size={36} color={colors.textTertiary} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                    No pending requests
                  </Text>
                  <Text style={[styles.emptyDesc, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                    Contact requests you send or receive will appear here.
                  </Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </ScrollView>
      <Modal
        visible={avatarPreview !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAvatarPreview(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" }}
          onPress={() => setAvatarPreview(null)}
        >
          <Pressable style={{ alignItems: "center", gap: 16 }} onPress={() => {}}>
            <UserAvatar
              name={avatarPreview?.name ?? ""}
              avatarUrl={avatarPreview?.avatarUrl}
              size={160}
              showDot={false}
            />
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={{ color: "#fff", fontSize: 22, fontFamily: "Inter_600SemiBold" }}>
                {avatarPreview?.name}
              </Text>
              {avatarPreview?.username ? (
                <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 15, fontFamily: "Inter_400Regular" }}>
                  @{avatarPreview.username}
                </Text>
              ) : null}
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
  addBtn: {
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
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabText: { fontSize: 14 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 11 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8, marginBottom: 8, paddingHorizontal: 2 },
  list: { padding: 12, gap: 0 },
  listEmpty: { flex: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  contactName: { fontSize: 15 },
  contactSub: { fontSize: 13 },
  actionBtn: { padding: 8 },
  requestActions: { flexDirection: "row", gap: 8 },
  acceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 72,
    alignItems: "center",
  },
  acceptBtnText: { color: "#fff", fontSize: 13 },
  declineBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 72,
    alignItems: "center",
  },
  declineBtnText: { fontSize: 13 },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  cancelBtnText: { fontSize: 13 },
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
