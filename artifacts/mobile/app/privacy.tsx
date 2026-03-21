import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Switch,
  ActivityIndicator,
  Image,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";

interface PrivacyContact {
  contactUserId: number;
  name: string;
  username: string;
  avatarUrl: string | null;
  isWhitelisted: boolean;
}

interface PrivacySettings {
  presenceVisibility: "all" | "specific" | "none";
  readReceiptsEnabled: boolean;
  offlineThresholdMinutes: number;
  whitelistedContactIds: number[];
}

function Avatar({ name, avatarUrl, size = 36, colors }: { name: string; avatarUrl: string | null; size?: number; colors: any }) {
  const initials = name.trim().charAt(0).toUpperCase();
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.accent, fontSize: size * 0.4, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
    </View>
  );
}

const THRESHOLD_PRESETS = [
  { label: "1 min", value: 1 },
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
];

export default function PrivacyScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, put, getFileUrl } = useApi();

  const [settings, setSettings] = useState<PrivacySettings>({
    presenceVisibility: "all",
    readReceiptsEnabled: true,
    offlineThresholdMinutes: 5,
    whitelistedContactIds: [],
  });
  const [contacts, setContacts] = useState<PrivacyContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customThreshold, setCustomThreshold] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        get("/users/privacy"),
        get("/users/privacy/contacts"),
      ]);
      setSettings(s);
      setContacts(c);
      setSelectedIds(new Set(s.whitelistedContactIds));
      const isPreset = THRESHOLD_PRESETS.some(p => p.value === s.offlineThresholdMinutes);
      if (!isPreset) {
        setShowCustomInput(true);
        setCustomThreshold(String(s.offlineThresholdMinutes));
      }
    } catch {
      Alert.alert("Error", "Could not load privacy settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const save = async (overrides?: Partial<PrivacySettings & { whitelistedContactIds: number[] }>) => {
    setSaving(true);
    try {
      const merged = { ...settings, whitelistedContactIds: [...selectedIds], ...overrides };
      await put("/users/privacy", {
        presenceVisibility: merged.presenceVisibility,
        readReceiptsEnabled: merged.readReceiptsEnabled,
        offlineThresholdMinutes: merged.offlineThresholdMinutes,
        whitelistedContactIds: merged.presenceVisibility === "specific" ? merged.whitelistedContactIds : [],
      });
      if (overrides) setSettings(prev => ({ ...prev, ...overrides }));
    } catch {
      Alert.alert("Error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const setVisibility = (v: "all" | "specific" | "none") => {
    setSettings(prev => ({ ...prev, presenceVisibility: v }));
    save({ presenceVisibility: v });
  };

  const toggleContact = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveWhitelist = async () => {
    setSaving(true);
    try {
      await put("/users/privacy", {
        presenceVisibility: "specific",
        readReceiptsEnabled: settings.readReceiptsEnabled,
        offlineThresholdMinutes: settings.offlineThresholdMinutes,
        whitelistedContactIds: [...selectedIds],
      });
      Alert.alert("Saved", "Your contact visibility list has been updated.");
    } catch {
      Alert.alert("Error", "Could not save contact list.");
    } finally {
      setSaving(false);
    }
  };

  const toggleReceipts = (val: boolean) => {
    setSettings(prev => ({ ...prev, readReceiptsEnabled: val }));
    save({ readReceiptsEnabled: val });
  };

  const selectThreshold = (mins: number) => {
    setShowCustomInput(false);
    setCustomThreshold("");
    setSettings(prev => ({ ...prev, offlineThresholdMinutes: mins }));
    save({ offlineThresholdMinutes: mins });
  };

  const applyCustomThreshold = () => {
    const val = parseInt(customThreshold, 10);
    if (!Number.isFinite(val) || val < 1 || val > 1440) {
      Alert.alert("Invalid value", "Please enter a number between 1 and 1440 minutes.");
      return;
    }
    setSettings(prev => ({ ...prev, offlineThresholdMinutes: val }));
    save({ offlineThresholdMinutes: val });
  };

  const visibilityOptions: { value: "all" | "specific" | "none"; label: string; sublabel: string; icon: string }[] = [
    { value: "all", label: "All contacts", sublabel: "Everyone on your contact list sees you online", icon: "users" },
    { value: "specific", label: "Specific contacts", sublabel: "Only selected contacts see you online", icon: "user-check" },
    { value: "none", label: "Nobody", sublabel: "No one sees you online — you appear offline to all", icon: "eye-off" },
  ];

  const activePreset = THRESHOLD_PRESETS.find(p => p.value === settings.offlineThresholdMinutes);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.border, borderBottomColor: colors.textTertiary }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Privacy</Text>
          {saving ? <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 16 }} /> : <View style={{ width: 44 }} />}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">

            {/* ONLINE VISIBILITY */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>ONLINE VISIBILITY</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                Control who can see when you are currently online. Contacts not selected will see your last-seen time from before this chat instead.
              </Text>
              {visibilityOptions.map((opt, i) => (
                <Pressable
                  key={opt.value}
                  style={[
                    styles.optionRow,
                    i < visibilityOptions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                  ]}
                  onPress={() => setVisibility(opt.value)}
                >
                  <View style={[styles.optionIcon, { backgroundColor: settings.presenceVisibility === opt.value ? colors.accent : colors.accentSoft }]}>
                    <Feather name={opt.icon as any} size={16} color={settings.presenceVisibility === opt.value ? "#fff" : colors.accent} />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, { color: colors.text }]}>{opt.label}</Text>
                    <Text style={[styles.optionSub, { color: colors.textSecondary }]}>{opt.sublabel}</Text>
                  </View>
                  {settings.presenceVisibility === opt.value && (
                    <Feather name="check-circle" size={20} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </View>

            {/* SPECIFIC CONTACTS LIST */}
            {settings.presenceVisibility === "specific" && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>SELECT CONTACTS</Text>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                    Sorted by most communicated. Contacts not ticked will see your last-seen time instead of "online".
                  </Text>
                  {contacts.length === 0 ? (
                    <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No contacts yet.</Text>
                  ) : contacts.map((c, i) => (
                    <Pressable
                      key={c.contactUserId}
                      style={[
                        styles.contactRow,
                        i < contacts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                      ]}
                      onPress={() => toggleContact(c.contactUserId)}
                    >
                      <Avatar
                        name={c.name}
                        avatarUrl={c.avatarUrl ? getFileUrl(c.avatarUrl) : null}
                        colors={colors}
                      />
                      <View style={styles.contactText}>
                        <Text style={[styles.contactName, { color: colors.text }]}>{c.name}</Text>
                        <Text style={[styles.contactUsername, { color: colors.textTertiary }]}>@{c.username}</Text>
                      </View>
                      <View style={[
                        styles.checkbox,
                        { borderColor: selectedIds.has(c.contactUserId) ? colors.accent : colors.border },
                        selectedIds.has(c.contactUserId) && { backgroundColor: colors.accent },
                      ]}>
                        {selectedIds.has(c.contactUserId) && <Feather name="check" size={12} color="#fff" />}
                      </View>
                    </Pressable>
                  ))}
                  <Pressable
                    style={[styles.saveBtn, { backgroundColor: colors.accent }]}
                    onPress={saveWhitelist}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.saveBtnText}>Save contact list</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}

            {/* OFFLINE THRESHOLD */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>OFFLINE THRESHOLD</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                When you come back online after being away, the app will ask who can see you online — but only if you have been gone for at least this long. A shorter time means the prompt appears more often; a longer time means it appears less frequently.
              </Text>
              <View style={styles.presetRow}>
                {THRESHOLD_PRESETS.map(p => {
                  const isActive = !showCustomInput && settings.offlineThresholdMinutes === p.value;
                  return (
                    <Pressable
                      key={p.value}
                      style={[
                        styles.presetChip,
                        { borderColor: isActive ? colors.accent : colors.border, backgroundColor: isActive ? colors.accent : colors.surface },
                      ]}
                      onPress={() => selectThreshold(p.value)}
                    >
                      <Text style={[styles.presetChipText, { color: isActive ? "#fff" : colors.text }]}>{p.label}</Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={[
                    styles.presetChip,
                    { borderColor: showCustomInput ? colors.accent : colors.border, backgroundColor: showCustomInput ? colors.accent : colors.surface },
                  ]}
                  onPress={() => {
                    setShowCustomInput(true);
                    if (!customThreshold) setCustomThreshold(String(settings.offlineThresholdMinutes));
                  }}
                >
                  <Text style={[styles.presetChipText, { color: showCustomInput ? "#fff" : colors.text }]}>Custom</Text>
                </Pressable>
              </View>

              {showCustomInput && (
                <View style={[styles.customRow, { borderTopColor: colors.border }]}>
                  <TextInput
                    style={[styles.customInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={customThreshold}
                    onChangeText={setCustomThreshold}
                    placeholder="Minutes (1–1440)"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={applyCustomThreshold}
                  />
                  <Pressable
                    style={[styles.customApplyBtn, { backgroundColor: colors.accent }]}
                    onPress={applyCustomThreshold}
                    disabled={saving}
                  >
                    <Text style={styles.customApplyText}>Apply</Text>
                  </Pressable>
                </View>
              )}

              {!showCustomInput && (
                <View style={[styles.thresholdNote, { borderTopColor: colors.border }]}>
                  <Feather name="clock" size={13} color={colors.textTertiary} />
                  <Text style={[styles.thresholdNoteText, { color: colors.textTertiary }]}>
                    Currently set to {settings.offlineThresholdMinutes} {settings.offlineThresholdMinutes === 1 ? "minute" : "minutes"} (default: 5 min)
                  </Text>
                </View>
              )}
            </View>

            {/* READ RECEIPTS */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>READ RECEIPTS</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.receiptRow}>
                <View style={styles.receiptText}>
                  <Text style={[styles.optionLabel, { color: colors.text }]}>Send read receipts</Text>
                  <Text style={[styles.optionSub, { color: colors.textSecondary }]}>
                    {settings.readReceiptsEnabled
                      ? "Others see blue ticks when you read their messages"
                      : "Others see grey ticks only — you won't see theirs either"}
                  </Text>
                </View>
                <Switch
                  value={settings.readReceiptsEnabled}
                  onValueChange={toggleReceipts}
                  trackColor={{ false: colors.border, true: colors.accent + "88" }}
                  thumbColor={settings.readReceiptsEnabled ? colors.accent : colors.textTertiary}
                />
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 12 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    padding: 14,
    paddingBottom: 10,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { flex: 1 },
  optionLabel: { fontSize: 15, fontFamily: "Inter_500Medium", marginBottom: 2 },
  optionSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  contactText: { flex: 1 },
  contactName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  contactUsername: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: {
    margin: 14,
    marginTop: 4,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  receiptRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  receiptText: { flex: 1 },
  emptyText: {
    textAlign: "center",
    padding: 20,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  presetChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  customInput: {
    flex: 1,
    height: 40,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  customApplyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  customApplyText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  thresholdNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thresholdNoteText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
