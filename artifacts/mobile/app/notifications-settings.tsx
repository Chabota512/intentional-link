import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  Modal,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";

interface DndContact {
  contactUserId: number;
  name: string;
  username: string;
  avatarUrl: string | null;
  isWhitelisted: boolean;
}

interface DndSettings {
  isDndActive: boolean;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  scheduledDays: string[];
  notificationVolume: number;
  whitelistedContactIds: number[];
  activatedAt: string | null;
  dndExpiresAt: string | null;
}

interface DurationPreset {
  label: string;
  sublabel: string;
  minutes: number | null; // null = indefinite
}

const DURATION_PRESETS: DurationPreset[] = [
  { label: "30 minutes", sublabel: "Until then, all notifications are silenced", minutes: 30 },
  { label: "1 hour", sublabel: "Quick focus block", minutes: 60 },
  { label: "2 hours", sublabel: "Deep work session", minutes: 120 },
  { label: "4 hours", sublabel: "Half a day of quiet", minutes: 240 },
  { label: "Until I turn it off", sublabel: "No automatic end — you decide when to stop", minutes: null },
];

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const VOLUME_PRESETS = [
  { label: "Silent", value: 0, icon: "volume-x" },
  { label: "Low", value: 25, icon: "volume-1" },
  { label: "Medium", value: 60, icon: "volume-2" },
  { label: "Full", value: 100, icon: "volume-2" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 === 0 ? 12 : i % 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { label: `${h}:00 ${ampm}`, value: `${String(i).padStart(2, "0")}:00` };
});

function Avatar({ name, avatarUrl, size = 36, colors }: { name: string; avatarUrl: string | null; size?: number; colors: any }) {
  const initials = name.trim().charAt(0).toUpperCase();
  if (avatarUrl) return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.accent, fontSize: size * 0.4, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
    </View>
  );
}

function TimePicker({ value, onChange, label, colors }: { value: string | null; onChange: (v: string | null) => void; label: string; colors: any }) {
  const [open, setOpen] = useState(false);
  const display = value ? HOUR_OPTIONS.find(h => h.value === value)?.label ?? value : "Not set";
  return (
    <>
      <Pressable style={[styles.timeTrigger, { borderColor: colors.border, backgroundColor: colors.background }]} onPress={() => setOpen(true)}>
        <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.timeValue, { color: value ? colors.text : colors.textTertiary }]}>{display}</Text>
        <Feather name="chevron-down" size={14} color={colors.textTertiary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>{label}</Text>
            <ScrollView style={{ maxHeight: 260 }}>
              <Pressable onPress={() => { onChange(null); setOpen(false); }}>
                <Text style={[styles.pickerOption, { color: colors.textTertiary, borderBottomColor: colors.border }]}>Not set</Text>
              </Pressable>
              {HOUR_OPTIONS.map(h => (
                <Pressable key={h.value} onPress={() => { onChange(h.value); setOpen(false); }}>
                  <Text style={[styles.pickerOption, { color: h.value === value ? colors.accent : colors.text, borderBottomColor: colors.border }]}>
                    {h.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function NotificationsSettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, put, getFileUrl } = useApi();

  const [settings, setSettings] = useState<DndSettings>({
    isDndActive: false,
    scheduledStartTime: null,
    scheduledEndTime: null,
    scheduledDays: [],
    notificationVolume: 100,
    whitelistedContactIds: [],
    activatedAt: null,
    dndExpiresAt: null,
  });
  const [contacts, setContacts] = useState<DndContact[]>([]);
  const [selectedWhitelist, setSelectedWhitelist] = useState<Set<number>>(new Set());
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number | null>(60);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showWhitelistModal, setShowWhitelistModal] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pendingDndOn = useRef(false);

  // Tick every minute so the countdown refreshes live
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const remainingLabel = useMemo(() => {
    if (!settings.isDndActive) return null;
    if (!settings.dndExpiresAt) return "Active indefinitely";
    const msLeft = new Date(settings.dndExpiresAt).getTime() - now;
    if (msLeft <= 0) return "Expiring…";
    const totalMin = Math.ceil(msLeft / 60_000);
    if (totalMin < 60) return `${totalMin}m remaining`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m remaining` : `${h}h remaining`;
  }, [settings.isDndActive, settings.dndExpiresAt, now]);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([get("/users/dnd"), get("/users/dnd/contacts")]);
      setSettings(s);
      setContacts(c);
      setSelectedWhitelist(new Set(s.whitelistedContactIds));
    } catch {
      Alert.alert("Error", "Could not load notification settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const save = async (patch: Partial<DndSettings & { whitelistedContactIds: number[] }>) => {
    setSaving(true);
    try {
      await put("/users/dnd", patch);
      setSettings(prev => ({ ...prev, ...patch }));
    } catch {
      Alert.alert("Error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const toggleDnd = async (val: boolean) => {
    if (val) {
      pendingDndOn.current = true;
      setShowWhitelistModal(true);
    } else {
      await save({ isDndActive: false, whitelistedContactIds: [] });
      setSelectedWhitelist(new Set());
    }
  };

  const confirmDndOn = async () => {
    setShowWhitelistModal(false);
    const ids = [...selectedWhitelist];
    await save({ isDndActive: true, whitelistedContactIds: ids, dndDurationMinutes: selectedDurationMinutes } as any);
  };

  const cancelDndOn = () => {
    setShowWhitelistModal(false);
    pendingDndOn.current = false;
    setSelectedWhitelist(new Set(settings.whitelistedContactIds));
    setSelectedDurationMinutes(60);
  };

  const toggleWhitelistContact = (id: number) => {
    setSelectedWhitelist(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleDay = (day: string) => {
    const next = settings.scheduledDays.includes(day)
      ? settings.scheduledDays.filter(d => d !== day)
      : [...settings.scheduledDays, day];
    setSettings(prev => ({ ...prev, scheduledDays: next }));
    save({ scheduledDays: next });
  };

  const setVolume = (vol: number) => {
    setSettings(prev => ({ ...prev, notificationVolume: vol }));
    save({ notificationVolume: vol });
  };

  const setScheduleTime = (field: "scheduledStartTime" | "scheduledEndTime", val: string | null) => {
    setSettings(prev => ({ ...prev, [field]: val }));
    save({ [field]: val });
  };

  const scheduleConfigured = settings.scheduledStartTime && settings.scheduledEndTime && settings.scheduledDays.length > 0;

  return (
    <>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
          {saving
            ? <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 16 }} />
            : <View style={{ width: 44 }} />}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

            {/* DND TOGGLE */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>DO NOT DISTURB</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                When on, the app runs completely silently — no sounds, no notification banners. Messages still arrive and you can use the app normally. Callers are told you are in Do Not Disturb. This resets your whitelist each time you turn it on.
              </Text>
              <View style={[styles.toggleRow, { borderTopColor: colors.border }]}>
                <View style={styles.toggleLeft}>
                  <Text style={[styles.moonEmoji]}>{settings.isDndActive ? "🌙" : "🔔"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleLabel, { color: colors.text }]}>
                      {settings.isDndActive ? "Do Not Disturb is ON" : "Do Not Disturb is OFF"}
                    </Text>
                    {settings.isDndActive && remainingLabel ? (
                      <Text style={[styles.toggleSub, { color: "#6366F1", fontFamily: "Inter_500Medium" }]}>
                        {remainingLabel}
                      </Text>
                    ) : (
                      <Text style={[styles.toggleSub, { color: colors.textTertiary }]}>
                        {settings.isDndActive ? "Tap to turn off and clear whitelist" : "Tap to enable and choose who can still call"}
                      </Text>
                    )}
                  </View>
                </View>
                <Switch
                  value={settings.isDndActive}
                  onValueChange={toggleDnd}
                  trackColor={{ false: colors.border, true: "#6366F188" }}
                  thumbColor={settings.isDndActive ? "#6366F1" : colors.textTertiary}
                />
              </View>
              {settings.isDndActive && settings.whitelistedContactIds.length > 0 && (
                <View style={[styles.whitelistNote, { borderTopColor: colors.border }]}>
                  <Feather name="user-check" size={13} color={colors.accent} />
                  <Text style={[styles.whitelistNoteText, { color: colors.textSecondary }]}>
                    {settings.whitelistedContactIds.length} contact{settings.whitelistedContactIds.length !== 1 ? "s" : ""} can still reach you
                  </Text>
                </View>
              )}
              {settings.isDndActive && settings.whitelistedContactIds.length === 0 && (
                <View style={[styles.whitelistNote, { borderTopColor: colors.border }]}>
                  <Feather name="shield" size={13} color={colors.textTertiary} />
                  <Text style={[styles.whitelistNoteText, { color: colors.textTertiary }]}>
                    No whitelist — everyone is silenced
                  </Text>
                </View>
              )}
            </View>

            {/* SCHEDULE */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>QUIET HOURS SCHEDULE</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                Set a recurring time window for Do Not Disturb to activate automatically. When the window starts, the app goes silent. When it ends, sounds return. You still need to turn DND on manually outside these hours.
              </Text>
              <View style={styles.timeRow}>
                <TimePicker
                  value={settings.scheduledStartTime}
                  onChange={v => setScheduleTime("scheduledStartTime", v)}
                  label="From"
                  colors={colors}
                />
                <Feather name="arrow-right" size={16} color={colors.textTertiary} />
                <TimePicker
                  value={settings.scheduledEndTime}
                  onChange={v => setScheduleTime("scheduledEndTime", v)}
                  label="Until"
                  colors={colors}
                />
              </View>
              <View style={[styles.daysRow, { borderTopColor: colors.border }]}>
                {DAYS.map(d => {
                  const active = settings.scheduledDays.includes(d.key);
                  return (
                    <Pressable
                      key={d.key}
                      style={[styles.dayChip, { borderColor: active ? "#6366F1" : colors.border, backgroundColor: active ? "#6366F1" : colors.surface }]}
                      onPress={() => toggleDay(d.key)}
                    >
                      <Text style={[styles.dayChipText, { color: active ? "#fff" : colors.textSecondary }]}>{d.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {scheduleConfigured ? (
                <View style={[styles.scheduleNote, { borderTopColor: colors.border }]}>
                  <Feather name="clock" size={13} color={colors.accent} />
                  <Text style={[styles.scheduleNoteText, { color: colors.textSecondary }]}>
                    Silent {settings.scheduledDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")} from{" "}
                    {HOUR_OPTIONS.find(h => h.value === settings.scheduledStartTime)?.label ?? settings.scheduledStartTime} to{" "}
                    {HOUR_OPTIONS.find(h => h.value === settings.scheduledEndTime)?.label ?? settings.scheduledEndTime}
                  </Text>
                </View>
              ) : (
                <View style={[styles.scheduleNote, { borderTopColor: colors.border }]}>
                  <Feather name="info" size={13} color={colors.textTertiary} />
                  <Text style={[styles.scheduleNoteText, { color: colors.textTertiary }]}>
                    Set a start time, end time, and at least one day to enable automatic quiet hours
                  </Text>
                </View>
              )}
            </View>

            {/* VOLUME */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>NOTIFICATION VOLUME</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                Controls how loud notification sounds and call ringtones are within the app. This is separate from your phone's system volume. Set to Silent to mute all sounds without enabling full Do Not Disturb mode.
              </Text>
              <View style={styles.volumeRow}>
                {VOLUME_PRESETS.map((p, i) => {
                  const active = settings.notificationVolume === p.value;
                  return (
                    <Pressable
                      key={p.value}
                      style={[
                        styles.volumeChip,
                        { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent : colors.surface },
                        i > 0 && { marginLeft: 8 },
                      ]}
                      onPress={() => setVolume(p.value)}
                    >
                      <Feather name={p.icon as any} size={14} color={active ? "#fff" : colors.textSecondary} />
                      <Text style={[styles.volumeChipText, { color: active ? "#fff" : colors.text }]}>{p.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

          </ScrollView>
        )}
      </View>

      {/* WHITELIST MODAL — shown when turning DND on */}
      <Modal visible={showWhitelistModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={cancelDndOn}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
            <Pressable onPress={cancelDndOn} style={styles.modalCancelBtn}>
              <Text style={[styles.modalCancel, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.text }]}>🌙 Enable Do Not Disturb</Text>
            <Pressable onPress={confirmDndOn} style={styles.modalConfirmBtn}>
              <Text style={[styles.modalConfirm, { color: "#6366F1" }]}>Turn On</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>

            {/* DURATION PICKER */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary, marginTop: 20 }]}>HOW LONG?</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {DURATION_PRESETS.map((preset, i) => {
                const active = selectedDurationMinutes === preset.minutes;
                return (
                  <Pressable
                    key={preset.label}
                    style={[
                      styles.durationRow,
                      i < DURATION_PRESETS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    ]}
                    onPress={() => setSelectedDurationMinutes(preset.minutes)}
                  >
                    <View style={styles.durationText}>
                      <Text style={[styles.durationLabel, { color: active ? colors.accent : colors.text }]}>{preset.label}</Text>
                      <Text style={[styles.durationSub, { color: colors.textTertiary }]}>{preset.sublabel}</Text>
                    </View>
                    <View style={[
                      styles.radioOuter,
                      { borderColor: active ? colors.accent : colors.border },
                      active && { backgroundColor: colors.accent },
                    ]}>
                      {active && <View style={styles.radioInner} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* WHITELIST */}
            <Text style={[styles.whitelistModalDesc, { color: colors.textSecondary, marginTop: 20 }]}>
              Choose contacts who can still reach you during this DND session — their calls will come through. Everyone else will be told you are unavailable.
            </Text>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary, marginTop: 4 }]}>
              {selectedWhitelist.size === 0 ? "NO CONTACTS SELECTED — EVERYONE IS SILENCED" : `${selectedWhitelist.size} CONTACT${selectedWhitelist.size !== 1 ? "S" : ""} CAN REACH YOU`}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {contacts.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textTertiary }]}>You have no contacts yet.</Text>
              ) : contacts.map((c, i) => (
                <Pressable
                  key={c.contactUserId}
                  style={[styles.contactRow, i < contacts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                  onPress={() => toggleWhitelistContact(c.contactUserId)}
                >
                  <Avatar name={c.name} avatarUrl={c.avatarUrl ? getFileUrl(c.avatarUrl) : null} colors={colors} />
                  <View style={styles.contactText}>
                    <Text style={[styles.contactName, { color: colors.text }]}>{c.name}</Text>
                    <Text style={[styles.contactUsername, { color: colors.textTertiary }]}>@{c.username}</Text>
                  </View>
                  <View style={[
                    styles.checkbox,
                    { borderColor: selectedWhitelist.has(c.contactUserId) ? "#6366F1" : colors.border },
                    selectedWhitelist.has(c.contactUserId) && { backgroundColor: "#6366F1" },
                  ]}>
                    {selectedWhitelist.has(c.contactUserId) && <Feather name="check" size={12} color="#fff" />}
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
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
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  moonEmoji: { fontSize: 22 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium", marginBottom: 2 },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  whitelistNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  whitelistNoteText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  timeTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  timeLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  timeValue: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  daysRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dayChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  dayChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  scheduleNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  scheduleNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  volumeRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
  },
  volumeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 4,
  },
  volumeChipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  pickerSheet: {
    width: "100%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  pickerTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    padding: 16,
    paddingBottom: 10,
  },
  pickerOption: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalCancelBtn: { minWidth: 60 },
  modalConfirmBtn: { minWidth: 60, alignItems: "flex-end" },
  modalCancel: { fontSize: 15, fontFamily: "Inter_400Regular" },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "center" },
  modalConfirm: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  whitelistModalDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    margin: 16,
    marginBottom: 8,
  },
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
  emptyText: {
    textAlign: "center",
    padding: 20,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
});
