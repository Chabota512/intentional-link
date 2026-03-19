import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/context/AuthContext";
import { useApi } from "@/hooks/useApi";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout, updateUser } = useAuth();
  const { get, uploadFile } = useApi();
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(user?.name ?? "");
  const [editUsername, setEditUsername] = useState(user?.username ?? "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const { data: sessions = [] } = useQuery<{ id: number; status: string }[]>({
    queryKey: ["sessions"],
    queryFn: () => get("/sessions"),
    staleTime: 30000,
  });

  const { data: contacts = [] } = useQuery<{ id: number }[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
    staleTime: 30000,
  });

  const activeSessions = sessions.filter((s) => s.status === "active").length;
  const totalSessions = sessions.length;
  const totalContacts = contacts.length;

  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/auth");
        },
      },
    ]);
  };

  const openEdit = () => {
    setEditName(user?.name ?? "");
    setEditUsername(user?.username ?? "");
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateUser({ name: editName.trim(), username: editUsername.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowEdit(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const ext = asset.uri.split(".").pop() ?? "jpg";
      const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
      const fileName = `avatar.${ext}`;
      const fileSize = asset.fileSize ?? 0;

      const uploaded = await uploadFile(asset.uri, fileName, fileSize, contentType);
      await updateUser({ avatarUrl: uploaded.url });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to upload avatar");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const avatarUrl = user?.avatarUrl
    ? user.avatarUrl.startsWith("http")
      ? user.avatarUrl
      : `${BASE_URL}${user.avatarUrl}`
    : null;

  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Profile</Text>
        <Pressable
          onPress={openEdit}
          style={({ pressed }) => [styles.editBtn, { backgroundColor: colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="edit-2" size={16} color={colors.textSecondary} />
          <Text style={[styles.editBtnText, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>Edit</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable onPress={handlePickAvatar} disabled={uploadingAvatar} style={styles.avatarWrapper}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={[styles.avatar, styles.avatarImage]} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{initial}</Text>
              </View>
            )}
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.accent }]}>
              {uploadingAvatar
                ? <ActivityIndicator size="small" color="#fff" />
                : <Feather name="camera" size={12} color="#fff" />
              }
            </View>
          </Pressable>
          <Text style={[styles.name, { color: colors.text, fontFamily: "Inter_700Bold" }]}>{user?.name}</Text>
          <Text style={[styles.username, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            @{user?.username}
          </Text>
          <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text, fontFamily: "Inter_700Bold" }]}>{totalSessions}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>Sessions</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text, fontFamily: "Inter_700Bold" }]}>{activeSessions}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>Active</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text, fontFamily: "Inter_700Bold" }]}>{totalContacts}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>Contacts</Text>
            </View>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
            ABOUT INTENTIONAL LINK
          </Text>
          <View style={styles.infoItem}>
            <Feather name="zap" size={16} color={colors.accent} />
            <Text style={[styles.infoText, { color: colors.text, fontFamily: "Inter_400Regular" }]}>
              Intentional, distraction-free communication
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.infoItem}>
            <Feather name="lock" size={16} color={colors.accent} />
            <Text style={[styles.infoText, { color: colors.text, fontFamily: "Inter_400Regular" }]}>
              Only your contacts can join sessions
            </Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.infoItem}>
            <Feather name="archive" size={16} color={colors.accent} />
            <Text style={[styles.infoText, { color: colors.text, fontFamily: "Inter_400Regular" }]}>
              All past sessions are archived and searchable
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.logoutBtn,
            { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={handleLogout}
        >
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={[styles.logoutText, { color: colors.danger, fontFamily: "Inter_600SemiBold" }]}>
            Sign Out
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showEdit} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setShowEdit(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text style={[styles.modalCancel, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>Cancel</Text>
              </Pressable>
              <Text style={[styles.modalTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>Edit Profile</Text>
              <Pressable onPress={handleSave} disabled={saving} style={({ pressed }) => ({ opacity: pressed || saving ? 0.6 : 1 })}>
                {saving
                  ? <ActivityIndicator size="small" color={colors.accent} />
                  : <Text style={[styles.modalSave, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]}>Save</Text>
                }
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={handlePickAvatar}
                disabled={uploadingAvatar}
                style={[styles.modalAvatarWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={[styles.modalAvatar, styles.avatarImage]} />
                ) : (
                  <View style={[styles.modalAvatar, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{editName.charAt(0).toUpperCase() || "?"}</Text>
                  </View>
                )}
                <Text style={[styles.changePhotoText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>
                  {uploadingAvatar ? "Uploading..." : "Change Photo"}
                </Text>
              </Pressable>

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>Display Name</Text>
                <View style={[styles.fieldInput, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    style={[styles.fieldText, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                    placeholder="Your name"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>Username</Text>
                <View style={[styles.fieldInput, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.fieldAt, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>@</Text>
                  <TextInput
                    value={editUsername}
                    onChangeText={setEditUsername}
                    style={[styles.fieldText, { color: colors.text, fontFamily: "Inter_400Regular", flex: 1 }]}
                    placeholder="username"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                  />
                </View>
                <Text style={[styles.fieldHint, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                  Other users can find you by your username
                </Text>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  editBtnText: { fontSize: 13 },
  scroll: { padding: 16, gap: 12 },
  profileCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarWrapper: {
    position: "relative",
    marginBottom: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4F6EF7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  avatarText: { fontSize: 32, color: "#fff" },
  name: { fontSize: 22 },
  username: { fontSize: 14 },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: "100%",
  },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statValue: { fontSize: 22 },
  statLabel: { fontSize: 11 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 32 },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 0,
  },
  sectionTitle: { fontSize: 11, letterSpacing: 1, marginBottom: 12 },
  infoItem: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 4 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  logoutText: { fontSize: 16 },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalCancel: { fontSize: 16 },
  modalTitle: { fontSize: 16 },
  modalSave: { fontSize: 16 },
  modalScroll: { padding: 20, gap: 20 },
  modalAvatarWrap: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  modalAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  changePhotoText: { fontSize: 14 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" },
  fieldInput: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldAt: { fontSize: 15, marginRight: 2 },
  fieldText: { fontSize: 15 },
  fieldHint: { fontSize: 12, marginTop: 2 },
});
