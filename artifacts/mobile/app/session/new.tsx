import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  FlatList,
  Switch,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import UserAvatar from "@/components/UserAvatar";
import { isOnline } from "@/utils/lastSeen";

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

export default function NewSessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { post, uploadFile, get } = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showPastMessages, setShowPastMessages] = useState(false);
  const [showNoContactsWarning, setShowNoContactsWarning] = useState(false);

  const { data: contacts = [], isLoading: loadingContacts } = useQuery<Contact[]>({
    queryKey: ["contacts"],
    queryFn: () => get("/contacts"),
  });

  const toggleContact = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowNoContactsWarning(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: { title: string; description?: string; imageUrl?: string; showPastMessages?: boolean }) =>
      post("/sessions", data),
    onSuccess: async (session) => {
      const inviteIds = Array.from(selectedIds);
      for (const userId of inviteIds) {
        try {
          await post(`/sessions/${session.id}/invite`, { userId });
        } catch {}
      }
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.dismiss();
      router.push(`/session/${session.id}`);
    },
  });

  const handlePickImage = async () => {
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
    setImageUri(asset.uri);
    setUploadingImage(true);
    try {
      const ext = asset.uri.split(".").pop() ?? "jpg";
      const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
      const uploaded = await uploadFile(asset.uri, `session_image.${ext}`, asset.fileSize ?? 0, contentType);
      setImageUrl(uploaded.url || uploaded.objectPath);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message || "Could not upload image.");
      setImageUri(null);
      setImageUrl(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const doCreate = () => {
    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      imageUrl: imageUrl ?? undefined,
      showPastMessages,
    });
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    if (selectedIds.size === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setShowNoContactsWarning(true);
      return;
    }
    doCreate();
  };

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.contactUser.id));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.dismiss()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Feather name="x" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
            New Chat
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.createBtn,
              { backgroundColor: title.trim() ? colors.accent : colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleCreate}
            disabled={!title.trim() || createMutation.isPending || uploadingImage}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.createBtnText, { fontFamily: "Inter_600SemiBold" }]}>Create</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={handlePickImage} disabled={uploadingImage} style={styles.iconWrapper}>
            {uploadingImage ? (
              <View style={[styles.iconRow, { backgroundColor: colors.accentSoft }]}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : imageUri ? (
              <View style={styles.imagePreviewWrapper}>
                <Image source={{ uri: imageUri }} style={styles.imagePreview} />
                <View style={[styles.imageEditBadge, { backgroundColor: colors.accent, borderColor: colors.background }]}>
                  <Feather name="camera" size={12} color="#fff" />
                </View>
              </View>
            ) : (
              <View style={[styles.iconRow, { backgroundColor: colors.accentSoft }]}>
                <Feather name="camera" size={24} color={colors.accent} />
              </View>
            )}
          </Pressable>
          <Text style={[styles.iconHint, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
            Tap to add a chat photo
          </Text>

          <Text style={[styles.label, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
            CHAT TITLE
          </Text>
          <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
              placeholder="e.g., Q3 Planning, Design Review…"
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              autoFocus
              returnKeyType="next"
              maxLength={40}
            />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
            DESCRIPTION (optional)
          </Text>
          <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border, minHeight: 90 }]}>
            <TextInput
              style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular", textAlignVertical: "top" }]}
              placeholder="What is this chat about?"
              placeholderTextColor={colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              maxLength={500}
            />
          </View>

          <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.toggleTextWrapper}>
              <Text style={[styles.toggleLabel, { color: colors.text, fontFamily: "Inter_500Medium" }]}>
                Show past messages
              </Text>
              <Text style={[styles.toggleHint, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                New members can see messages sent before they joined
              </Text>
            </View>
            <Switch
              value={showPastMessages}
              onValueChange={setShowPastMessages}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor="#fff"
            />
          </View>

          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
              INVITE CONTACTS
            </Text>
            {selectedIds.size > 0 && (
              <Text style={[styles.selectedCount, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]}>
                {selectedIds.size} selected
              </Text>
            )}
          </View>

          {selectedIds.size > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectedScroll} contentContainerStyle={styles.selectedRow}>
              {selectedContacts.map((c) => (
                <Pressable key={c.contactUser.id} onPress={() => toggleContact(c.contactUser.id)} style={styles.selectedChip}>
                  <UserAvatar name={c.contactUser.name} avatarUrl={c.contactUser.avatarUrl} size={36} />
                  <Text style={[styles.selectedChipName, { color: colors.text, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                    {c.contactUser.name.split(" ")[0]}
                  </Text>
                  <View style={[styles.removeChip, { backgroundColor: colors.danger }]}>
                    <Feather name="x" size={9} color="#fff" />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {loadingContacts ? (
            <View style={styles.contactsLoading}>
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          ) : contacts.length === 0 ? (
            <View style={[styles.noContacts, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Feather name="users" size={20} color={colors.textTertiary} />
              <Text style={[styles.noContactsText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                No contacts yet. Add contacts first to invite them.
              </Text>
            </View>
          ) : (
            <View style={[styles.contactsList, { borderColor: colors.border }]}>
              {contacts.map((contact, index) => {
                const u = contact.contactUser;
                const selected = selectedIds.has(u.id);
                return (
                  <Pressable
                    key={contact.id}
                    style={({ pressed }) => [
                      styles.contactRow,
                      {
                        backgroundColor: selected ? colors.accentSoft : colors.surface,
                        borderBottomColor: colors.border,
                        borderBottomWidth: index < contacts.length - 1 ? StyleSheet.hairlineWidth : 0,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    onPress={() => toggleContact(u.id)}
                  >
                    <UserAvatar name={u.name} avatarUrl={u.avatarUrl} size={40} isOnline={isOnline(u.lastSeenAt)} showDot />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.contactName, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
                        {u.name}
                      </Text>
                      <Text style={[styles.contactUsername, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                        @{u.username}
                      </Text>
                    </View>
                    <View style={[
                      styles.checkbox,
                      {
                        backgroundColor: selected ? colors.accent : "transparent",
                        borderColor: selected ? colors.accent : colors.border,
                      },
                    ]}>
                      {selected && <Feather name="check" size={13} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {showNoContactsWarning && (
            <View style={[styles.warningBox, { backgroundColor: colors.warning + "22", borderColor: colors.warning }]}>
              <View style={styles.warningTop}>
                <Feather name="alert-triangle" size={16} color={colors.warning} />
                <Text style={[styles.warningTitle, { fontFamily: "Inter_600SemiBold", color: colors.text }]}>
                  No contacts selected
                </Text>
              </View>
              <Text style={[styles.warningText, { fontFamily: "Inter_400Regular", color: colors.textSecondary }]}>
                You haven't added anyone to this chat. Create it anyway?
              </Text>
              <View style={styles.warningActions}>
                <Pressable
                  style={({ pressed }) => [styles.warningBtn, styles.warningBtnOutline, { borderColor: colors.warning, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => setShowNoContactsWarning(false)}
                >
                  <Text style={[styles.warningBtnText, { color: colors.text, fontFamily: "Inter_500Medium" }]}>Go back</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.warningBtn, { backgroundColor: colors.warning, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => { setShowNoContactsWarning(false); doCreate(); }}
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={[styles.warningBtnText, { color: "#fff", fontFamily: "Inter_600SemiBold" }]}>Create anyway</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {createMutation.isError && (
            <View style={[styles.errorBox, { backgroundColor: colors.danger + "18", borderColor: colors.danger }]}>
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "Inter_400Regular" }]}>
                {(createMutation.error as Error).message}
              </Text>
            </View>
          )}

          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 72,
    alignItems: "center",
  },
  createBtnText: { color: "#fff", fontSize: 14 },
  content: { padding: 20, gap: 12 },
  iconWrapper: { alignSelf: "center", marginBottom: 4 },
  iconRow: { width: 72, height: 72, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconHint: { fontSize: 12, textAlign: "center", marginTop: -6, marginBottom: 4 },
  imagePreviewWrapper: { position: "relative" },
  imagePreview: { width: 72, height: 72, borderRadius: 20 },
  imageEditBadge: {
    position: "absolute", bottom: -4, right: -4,
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  toggleTextWrapper: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 15 },
  toggleHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 11, letterSpacing: 0.8 },
  selectedCount: { fontSize: 12 },
  inputWrapper: { borderRadius: 14, borderWidth: 1, padding: 14 },
  input: { fontSize: 16, lineHeight: 24 },
  selectedScroll: { marginHorizontal: -4 },
  selectedRow: { flexDirection: "row", gap: 12, paddingHorizontal: 4, paddingVertical: 4 },
  selectedChip: { alignItems: "center", gap: 4, position: "relative" },
  selectedChipName: { fontSize: 11, maxWidth: 52, textAlign: "center" },
  removeChip: {
    position: "absolute", top: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#fff",
  },
  contactsLoading: { paddingVertical: 20, alignItems: "center" },
  noContacts: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  noContactsText: { flex: 1, fontSize: 13, lineHeight: 18 },
  contactsList: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  contactName: { fontSize: 15 },
  contactUsername: { fontSize: 12, marginTop: 1 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  errorBox: { padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13 },
  warningBox: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 8 },
  warningTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  warningTitle: { fontSize: 14 },
  warningText: { fontSize: 13, lineHeight: 18 },
  warningActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  warningBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  warningBtnOutline: { borderWidth: 1 },
  warningBtnText: { fontSize: 14 },
});
