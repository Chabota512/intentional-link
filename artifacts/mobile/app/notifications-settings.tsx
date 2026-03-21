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
  TextInput,
} from "react-native";
import Slider from "@react-native-community/slider";
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

interface DaySchedule {
  day: string;
  startTime: string;
  endTime: string;
}

interface DndSettings {
  isDndActive: boolean;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  scheduledDays: string[];
  quietHourSchedules: DaySchedule[];
  notificationVolume: number;
  whitelistedContactIds: number[];
  activatedAt: string | null;
  dndExpiresAt: string | null;
}

interface DurationPreset {
  label: string;
  minutes: number | null;
}

const DURATION_PRESETS: DurationPreset[] = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "∞", minutes: null },
];

const DAYS = [
  { key: "sun", label: "S", full: "Sunday" },
  { key: "mon", label: "M", full: "Monday" },
  { key: "tue", label: "T", full: "Tuesday" },
  { key: "wed", label: "W", full: "Wednesday" },
  { key: "thu", label: "T", full: "Thursday" },
  { key: "fri", label: "F", full: "Friday" },
  { key: "sat", label: "S", full: "Saturday" },
];


const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 === 0 ? 12 : i % 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { label: `${h}:00 ${ampm}`, value: `${String(i).padStart(2, "0")}:00` };
});

function Avatar({ name, avatarUrl, size = 38, colors }: { name: string; avatarUrl: string | null; size?: number; colors: any }) {
  const initials = name.trim().charAt(0).toUpperCase();
  if (avatarUrl) return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.accent, fontSize: size * 0.38, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
    </View>
  );
}


function parseCustomTime(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, " ");

  const withMinAmPm = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (withMinAmPm) {
    let h = parseInt(withMinAmPm[1]);
    const m = parseInt(withMinAmPm[2]);
    const pm = withMinAmPm[3] === "PM";
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const hourAmPm = cleaned.match(/^(\d{1,2})\s*(AM|PM)$/);
  if (hourAmPm) {
    let h = parseInt(hourAmPm[1]);
    const pm = hourAmPm[2] === "PM";
    if (h < 1 || h > 12) return null;
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, "0")}:00`;
  }

  const mil = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (mil) {
    const h = parseInt(mil[1]);
    const m = parseInt(mil[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return null;
}

function formatTimeValue(value: string): string {
  const preset = HOUR_OPTIONS.find(h => h.value === value);
  if (preset) return preset.label;
  const [hStr, mStr] = value.split(":");
  const h = parseInt(hStr);
  const m = parseInt(mStr);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function TimePicker({ value, onChange, label, colors }: { value: string | null; onChange: (v: string | null) => void; label: string; colors: any }) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [customError, setCustomError] = useState(false);

  const display = value ? formatTimeValue(value) : "—";

  const handleCustomSubmit = () => {
    const parsed = parseCustomTime(customInput);
    if (!parsed) { setCustomError(true); return; }
    setCustomError(false);
    onChange(parsed);
    setOpen(false);
    setCustomInput("");
  };

  const handleOpen = () => {
    setCustomInput("");
    setCustomError(false);
    setOpen(true);
  };

  return (
    <>
      <Pressable
        style={[styles.timeTrigger, { borderColor: value ? colors.accent : colors.border, backgroundColor: value ? colors.accentSoft : colors.surface }]}
        onPress={handleOpen}
      >
        <Text style={[styles.timeLabel, { color: colors.textTertiary }]}>{label}</Text>
        <Text style={[styles.timeValue, { color: value ? colors.accent : colors.textSecondary }]}>{display}</Text>
        <Feather name="chevron-down" size={13} color={value ? colors.accent : colors.textTertiary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>{label}</Text>

            {/* Custom time entry */}
            <View style={[styles.customTimeRow, { borderColor: customError ? "#EF4444" : colors.border, backgroundColor: colors.background }]}>
              <Feather name="clock" size={15} color={customError ? "#EF4444" : colors.textTertiary} />
              <TextInput
                style={[styles.customTimeInput, { color: colors.text }]}
                placeholder="e.g. 3:45 PM or 15:45"
                placeholderTextColor={colors.textTertiary}
                value={customInput}
                onChangeText={t => { setCustomInput(t); setCustomError(false); }}
                onSubmitEditing={handleCustomSubmit}
                returnKeyType="done"
                autoCorrect={false}
              />
              <Pressable onPress={handleCustomSubmit} style={[styles.customTimeSet, { backgroundColor: colors.accent }]}>
                <Text style={styles.customTimeSetText}>Set</Text>
              </Pressable>
            </View>
            {customError && (
              <Text style={styles.customTimeError}>Enter a time like "3:45 PM" or "15:45"</Text>
            )}

            <ScrollView style={{ maxHeight: 240 }}>
              <Pressable onPress={() => { onChange(null); setOpen(false); }}>
                <Text style={[styles.pickerOption, { color: colors.textTertiary, borderBottomColor: colors.border }]}>Clear</Text>
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
    quietHourSchedules: [],
    notificationVolume: 100,
    whitelistedContactIds: [],
    activatedAt: null,
    dndExpiresAt: null,
  });
  const [contacts, setContacts] = useState<DndContact[]>([]);
  const [selectedWhitelist, setSelectedWhitelist] = useState<Set<number>>(new Set());
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number | null>(60);
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  const [customHours, setCustomHours] = useState(0);
  const [customMinutes, setCustomMinutes] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showWhitelistModal, setShowWhitelistModal] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pendingDndOn = useRef(false);

  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [editStart, setEditStart] = useState<string | null>(null);
  const [editEnd, setEditEnd] = useState<string | null>(null);

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

  const save = async (patch: Partial<DndSettings & { whitelistedContactIds: number[]; dndDurationMinutes?: number | null }>) => {
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
    setShowCustomDuration(false);
    setCustomHours(0);
    setCustomMinutes(30);
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

  const openDayEditor = (day: string) => {
    const existing = settings.quietHourSchedules.find(s => s.day === day);
    setEditStart(existing?.startTime ?? null);
    setEditEnd(existing?.endTime ?? null);
    setEditingDay(day);
  };

  const saveDaySchedule = () => {
    if (!editingDay || !editStart || !editEnd) return;
    const next = [
      ...settings.quietHourSchedules.filter(s => s.day !== editingDay),
      { day: editingDay, startTime: editStart, endTime: editEnd },
    ];
    next.sort((a, b) => DAYS.findIndex(d => d.key === a.day) - DAYS.findIndex(d => d.key === b.day));
    setSettings(prev => ({ ...prev, quietHourSchedules: next }));
    save({ quietHourSchedules: next } as any);
    setEditingDay(null);
  };

  const removeDaySchedule = (day: string) => {
    const next = settings.quietHourSchedules.filter(s => s.day !== day);
    setSettings(prev => ({ ...prev, quietHourSchedules: next }));
    save({ quietHourSchedules: next } as any);
  };

  return (
    <>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* HEADER */}
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
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>

            {/* ── DND HERO ── */}
            <View style={styles.heroSection}>
              <Pressable
                style={[
                  styles.dndHero,
                  settings.isDndActive
                    ? { backgroundColor: "#1a1040", borderColor: "#6366F130" }
                    : { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                onPress={() => toggleDnd(!settings.isDndActive)}
                activeOpacity={0.85}
              >
                <View style={styles.dndHeroLeft}>
                  <Text style={styles.dndHeroIcon}>{settings.isDndActive ? "🌙" : "🔔"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dndHeroTitle, { color: settings.isDndActive ? "#fff" : colors.text }]}>
                      {settings.isDndActive ? "Do Not Disturb" : "Do Not Disturb"}
                    </Text>
                    {settings.isDndActive ? (
                      <Text style={styles.dndCountdown}>{remainingLabel}</Text>
                    ) : (
                      <Text style={[styles.dndHeroSub, { color: colors.textTertiary }]}>Tap to enable</Text>
                    )}
                  </View>
                </View>
                <Switch
                  value={settings.isDndActive}
                  onValueChange={toggleDnd}
                  trackColor={{ false: colors.border, true: "#6366F188" }}
                  thumbColor={settings.isDndActive ? "#6366F1" : colors.textTertiary}
                />
              </Pressable>

              {settings.isDndActive && (
                <View style={[styles.dndMetaRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.dndMetaItem}>
                    <Feather name={settings.whitelistedContactIds.length > 0 ? "user-check" : "shield"} size={14}
                      color={settings.whitelistedContactIds.length > 0 ? "#6366F1" : colors.textTertiary} />
                    <Text style={[styles.dndMetaText, {
                      color: settings.whitelistedContactIds.length > 0 ? colors.textSecondary : colors.textTertiary
                    }]}>
                      {settings.whitelistedContactIds.length > 0
                        ? `${settings.whitelistedContactIds.length} contact${settings.whitelistedContactIds.length !== 1 ? "s" : ""} can reach you`
                        : "Everyone silenced"}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* ── QUIET HOURS ── */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>QUIET HOURS</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {DAYS.map((d, i) => {
                const sched = settings.quietHourSchedules.find(s => s.day === d.key);
                const isLast = i === DAYS.length - 1;
                return (
                  <Pressable
                    key={d.key}
                    style={[
                      styles.quietDayRow,
                      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    ]}
                    onPress={() => openDayEditor(d.key)}
                  >
                    <Text style={[styles.quietDayName, { color: sched ? colors.text : colors.textSecondary }]}>{d.full}</Text>
                    {sched ? (
                      <>
                        <Text style={[styles.quietDayTime, { color: colors.accent }]}>
                          {HOUR_OPTIONS.find(h => h.value === sched.startTime)?.label} – {HOUR_OPTIONS.find(h => h.value === sched.endTime)?.label}
                        </Text>
                        <Pressable onPress={() => removeDaySchedule(d.key)} hitSlop={10} style={styles.quietDayRemove}>
                          <Feather name="x" size={15} color={colors.textTertiary} />
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.quietDayOff, { color: colors.textTertiary }]}>Off</Text>
                        <Feather name="plus" size={16} color={colors.textTertiary} />
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* ── VOLUME ── */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>NOTIFICATION VOLUME</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.volumeRow}>
                <Feather
                  name={settings.notificationVolume === 0 ? "volume-x" : settings.notificationVolume < 50 ? "volume-1" : "volume-2"}
                  size={18}
                  color={colors.accent}
                />
                <Slider
                  style={styles.volumeSlider}
                  minimumValue={0}
                  maximumValue={100}
                  step={1}
                  value={settings.notificationVolume}
                  onValueChange={(val) => setSettings(prev => ({ ...prev, notificationVolume: val }))}
                  onSlidingComplete={(val) => setVolume(val)}
                  minimumTrackTintColor={colors.accent}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.accent}
                />
                <Text style={[styles.volumeLabel, { color: colors.textSecondary }]}>{settings.notificationVolume}%</Text>
              </View>
            </View>

          </ScrollView>
        )}
      </View>

      {/* ── DAY SCHEDULE EDITOR MODAL ── */}
      <Modal visible={!!editingDay} transparent animationType="fade" onRequestClose={() => setEditingDay(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditingDay(null)}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.surface, borderColor: colors.border, width: "90%" }]}>
            <Text style={[styles.pickerTitle, { color: colors.text, marginBottom: 4 }]}>
              {DAYS.find(d => d.key === editingDay)?.full} Quiet Hours
            </Text>
            <Text style={[styles.scheduleNoteText, { color: colors.textTertiary, marginBottom: 16 }]}>
              Notifications will be silenced during this window.
            </Text>
            <View style={[styles.timeRow, { padding: 0, marginBottom: 20 }]}>
              <TimePicker value={editStart} onChange={setEditStart} label="From" colors={colors} />
              <Feather name="arrow-right" size={15} color={colors.textTertiary} />
              <TimePicker value={editEnd} onChange={setEditEnd} label="Until" colors={colors} />
            </View>
            <Pressable
              style={[
                styles.saveBtn,
                { backgroundColor: (!editStart || !editEnd) ? colors.border : colors.accent },
              ]}
              onPress={saveDaySchedule}
              disabled={!editStart || !editEnd}
            >
              <Text style={[styles.saveBtnText, { color: (!editStart || !editEnd) ? colors.textTertiary : "#fff" }]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── ENABLE DND MODAL ── */}
      <Modal visible={showWhitelistModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={cancelDndOn}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>

          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
            <Pressable onPress={cancelDndOn} hitSlop={8}>
              <Text style={[styles.modalAction, { color: colors.textSecondary }]}>Cancel</Text>
            </Pressable>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalEmoji}>🌙</Text>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Do Not Disturb</Text>
            </View>
            <Pressable onPress={confirmDndOn} hitSlop={8}>
              <Text style={[styles.modalAction, { color: "#6366F1", fontFamily: "Inter_600SemiBold" }]}>Turn On</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>

            {/* Duration */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary, marginTop: 24 }]}>DURATION</Text>
            <View style={[styles.durationChipRow, { marginHorizontal: 16 }]}>
              {DURATION_PRESETS.map(preset => {
                const active = !showCustomDuration && selectedDurationMinutes === preset.minutes;
                return (
                  <Pressable
                    key={preset.label}
                    style={[
                      styles.durationChip,
                      { borderColor: active ? "#6366F1" : colors.border, backgroundColor: active ? "#6366F1" : colors.surface },
                    ]}
                    onPress={() => { setShowCustomDuration(false); setSelectedDurationMinutes(preset.minutes); }}
                  >
                    <Text style={[styles.durationChipText, { color: active ? "#fff" : colors.text }]}>{preset.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={[
                  styles.durationChip,
                  { borderColor: showCustomDuration ? "#6366F1" : colors.border, backgroundColor: showCustomDuration ? "#6366F1" : colors.surface },
                ]}
                onPress={() => { setShowCustomDuration(true); setCustomDurationInput(""); setCustomDurationError(false); }}
              >
                <Text style={[styles.durationChipText, { color: showCustomDuration ? "#fff" : colors.text }]}>Custom</Text>
              </Pressable>
            </View>

            {showCustomDuration && (
              <View style={[styles.durationStepperCard, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16 }]}>
                {/* Hours stepper */}
                <View style={styles.durationStepperCol}>
                  <Text style={[styles.durationStepperLabel, { color: colors.textTertiary }]}>Hours</Text>
                  <View style={styles.durationStepperRow}>
                    <Pressable
                      style={[styles.durationStepBtn, { borderColor: colors.border }]}
                      onPress={() => {
                        const next = Math.max(0, customHours - 1);
                        setCustomHours(next);
                        setSelectedDurationMinutes(next * 60 + customMinutes || 1);
                      }}
                    >
                      <Feather name="minus" size={16} color={customHours === 0 ? colors.textTertiary : colors.text} />
                    </Pressable>
                    <Text style={[styles.durationStepValue, { color: colors.text }]}>{customHours}h</Text>
                    <Pressable
                      style={[styles.durationStepBtn, { borderColor: colors.border }]}
                      onPress={() => {
                        const next = Math.min(23, customHours + 1);
                        setCustomHours(next);
                        setSelectedDurationMinutes(next * 60 + customMinutes);
                      }}
                    >
                      <Feather name="plus" size={16} color={colors.text} />
                    </Pressable>
                  </View>
                </View>

                <View style={[styles.durationStepperDivider, { backgroundColor: colors.border }]} />

                {/* Minutes stepper */}
                <View style={styles.durationStepperCol}>
                  <Text style={[styles.durationStepperLabel, { color: colors.textTertiary }]}>Minutes</Text>
                  <View style={styles.durationStepperRow}>
                    <Pressable
                      style={[styles.durationStepBtn, { borderColor: colors.border }]}
                      onPress={() => {
                        const next = Math.max(0, customMinutes - 5);
                        setCustomMinutes(next);
                        setSelectedDurationMinutes(customHours * 60 + next || 1);
                      }}
                    >
                      <Feather name="minus" size={16} color={customMinutes === 0 ? colors.textTertiary : colors.text} />
                    </Pressable>
                    <Text style={[styles.durationStepValue, { color: colors.text }]}>{customMinutes}m</Text>
                    <Pressable
                      style={[styles.durationStepBtn, { borderColor: colors.border }]}
                      onPress={() => {
                        const next = Math.min(55, customMinutes + 5);
                        setCustomMinutes(next);
                        setSelectedDurationMinutes(customHours * 60 + next);
                      }}
                    >
                      <Feather name="plus" size={16} color={customMinutes === 55 ? colors.textTertiary : colors.text} />
                    </Pressable>
                  </View>
                </View>
              </View>
            )}

            {/* Whitelist */}
            <Text style={[styles.sectionLabel, { color: colors.textTertiary, marginTop: 28 }]}>
              {selectedWhitelist.size === 0 ? "WHO CAN STILL REACH YOU" : `WHO CAN STILL REACH YOU · ${selectedWhitelist.size} SELECTED`}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {contacts.length === 0 ? (
                <View style={styles.emptyState}>
                  <Feather name="users" size={22} color={colors.textTertiary} />
                  <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No contacts yet</Text>
                </View>
              ) : contacts.map((c, i) => (
                <Pressable
                  key={c.contactUserId}
                  style={[
                    styles.contactRow,
                    i < contacts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                    selectedWhitelist.has(c.contactUserId) && { backgroundColor: colors.accentSoft ?? colors.background },
                  ]}
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
                    {selectedWhitelist.has(c.contactUserId) && <Feather name="check" size={13} color="#fff" />}
                  </View>
                </Pressable>
              ))}
            </View>

            {contacts.length > 0 && selectedWhitelist.size === 0 && (
              <Text style={[styles.whitelistHint, { color: colors.textTertiary }]}>
                No one selected — everyone will be silenced
              </Text>
            )}

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

  heroSection: { marginHorizontal: 16, marginTop: 24, gap: 0 },
  dndHero: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dndHeroLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  dndHeroIcon: { fontSize: 28 },
  dndHeroTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  dndHeroSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  dndCountdown: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#8B8FFA" },
  dndMetaRow: {
    marginTop: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
  },
  dndMetaItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  dndMetaText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginHorizontal: 16,
    marginTop: 28,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },

  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  timeTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  timeLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  timeValue: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },

  daysRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "space-between",
  },
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  dayChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  scheduleNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  scheduleNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  quietDayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  quietDayName: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  quietDayTime: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  quietDayOff: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  quietDayRemove: {
    padding: 2,
  },

  saveBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },

  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  volumeSlider: {
    flex: 1,
    height: 40,
  },
  volumeLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    minWidth: 36,
    textAlign: "right",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
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
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 4,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingLeft: 10,
    gap: 8,
    overflow: "hidden",
  },
  customTimeInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingVertical: 10,
  },
  customTimeSet: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  customTimeSetText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  customTimeError: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#EF4444",
    marginHorizontal: 14,
    marginBottom: 8,
  },

  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  modalEmoji: { fontSize: 18 },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  modalAction: { fontSize: 15, fontFamily: "Inter_400Regular" },

  durationStepperCard: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    overflow: "hidden",
  },
  durationStepperCol: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    gap: 10,
  },
  durationStepperLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  durationStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  durationStepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  durationStepValue: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    minWidth: 44,
    textAlign: "center",
  },
  durationStepperDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },

  durationChipRow: {
    flexDirection: "row",
    gap: 8,
  },
  durationChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  durationChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  contactText: { flex: 1 },
  contactName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  contactUsername: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyState: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  whitelistHint: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
    marginHorizontal: 16,
  },
});
