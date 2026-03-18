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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/context/AuthContext";

export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, logout, updateUser } = useAuth();
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(user?.name ?? "");
  const [editUsername, setEditUsername] = useState(user?.username ?? "");
  const [saving, setSaving] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
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

  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 20, borderBottomColor: colors.border }]}>
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
          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{initial}</Text>
          </View>
          <Text style={[styles.name, { color: colors.text, fontFamily: "Inter_700Bold" }]}>{user?.name}</Text>
          <Text style={[styles.username, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            @{user?.username}
          </Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
            ABOUT FOCUS
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
              <View style={[styles.modalAvatarWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[styles.modalAvatar, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{editName.charAt(0).toUpperCase() || "?"}</Text>
                </View>
              </View>

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
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 28, lineHeight: 34 },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  editBtnText: { fontSize: 13 },
  scroll: { padding: 20, gap: 16 },
  profileCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    shadowColor: "#4F6EF7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  avatarText: { fontSize: 32, color: "#fff" },
  name: { fontSize: 22 },
  username: { fontSize: 14 },
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
  },
  modalAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
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
