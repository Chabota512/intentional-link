import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSocket } from "@/context/SocketContext";
import { useApi } from "@/hooks/useApi";
import { useTheme } from "@/hooks/useTheme";

interface Contact {
  contactUserId: number;
  name: string;
  username: string;
  avatarUrl: string | null;
  isWhitelisted: boolean;
}

function Avatar({ name, avatarUrl, size = 38, colors }: { name: string; avatarUrl: string | null; size?: number; colors: any }) {
  const initials = name.trim().charAt(0).toUpperCase();
  if (avatarUrl) {
    return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.accent, fontSize: size * 0.38, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
    </View>
  );
}

export function PresenceDialog() {
  const { colors } = useTheme();
  const { presenceDialogData, dismissPresenceDialog } = useSocket();
  const { get, put, getFileUrl } = useApi();

  const [step, setStep] = useState<"choice" | "contacts">("choice");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [saving, setSaving] = useState(false);

  const visible = presenceDialogData !== null;

  useEffect(() => {
    if (visible) {
      setStep("choice");
      setSelectedIds(new Set(presenceDialogData?.whitelistedContactIds ?? []));
    }
  }, [visible]);

  const handleAllContacts = async () => {
    setSaving(true);
    try {
      await put("/users/privacy", {
        presenceVisibility: "all",
        readReceiptsEnabled: presenceDialogData?.readReceiptsEnabled ?? true,
        whitelistedContactIds: [],
      });
    } catch {}
    setSaving(false);
    dismissPresenceDialog();
  };

  const handleSpecificContacts = async () => {
    setLoadingContacts(true);
    try {
      const data = await get("/users/privacy/contacts");
      setContacts(data);
    } catch {}
    setLoadingContacts(false);
    setStep("contacts");
  };

  const toggleContact = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSaveContacts = async () => {
    setSaving(true);
    try {
      await put("/users/privacy", {
        presenceVisibility: "specific",
        readReceiptsEnabled: presenceDialogData?.readReceiptsEnabled ?? true,
        whitelistedContactIds: [...selectedIds],
      });
    } catch {}
    setSaving(false);
    dismissPresenceDialog();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {step === "choice" ? (
            <>
              <View style={[styles.iconWrap, { backgroundColor: "#dcfce7" }]}>
                <Feather name="wifi" size={24} color="#16a34a" />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>You're back online</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Who would you like to let know that you are currently online?
              </Text>

              <Pressable
                style={[styles.optionBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={handleAllContacts}
                disabled={saving}
              >
                <View style={[styles.optBtnIcon, { backgroundColor: colors.accent }]}>
                  <Feather name="users" size={18} color="#fff" />
                </View>
                <View style={styles.optBtnText}>
                  <Text style={[styles.optBtnLabel, { color: colors.text }]}>All my contacts</Text>
                  <Text style={[styles.optBtnSub, { color: colors.textSecondary }]}>
                    Everyone sees you online and gets read receipts
                  </Text>
                </View>
                {saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Feather name="chevron-right" size={18} color={colors.textTertiary} />}
              </Pressable>

              <Pressable
                style={[styles.optionBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={handleSpecificContacts}
                disabled={saving || loadingContacts}
              >
                <View style={[styles.optBtnIcon, { backgroundColor: colors.accentSoft }]}>
                  <Feather name="user-check" size={18} color={colors.accent} />
                </View>
                <View style={styles.optBtnText}>
                  <Text style={[styles.optBtnLabel, { color: colors.text }]}>Specific contacts</Text>
                  <Text style={[styles.optBtnSub, { color: colors.textSecondary }]}>
                    Choose who sees you online — others see your last-seen time
                  </Text>
                </View>
                {loadingContacts ? <ActivityIndicator size="small" color={colors.accent} /> : <Feather name="chevron-right" size={18} color={colors.textTertiary} />}
              </Pressable>

              <Pressable onPress={dismissPresenceDialog} style={styles.skipBtn}>
                <Text style={[styles.skipText, { color: colors.textTertiary }]}>Stay hidden for now</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => setStep("choice")} style={styles.backRow}>
                <Feather name="arrow-left" size={18} color={colors.accent} />
                <Text style={[styles.backText, { color: colors.accent }]}>Back</Text>
              </Pressable>
              <Text style={[styles.title, { color: colors.text }]}>Select contacts</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Tap contacts who can see you're online. The rest will see your last-seen time.
              </Text>

              <ScrollView style={styles.contactList} showsVerticalScrollIndicator={false}>
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
                    <Avatar name={c.name} avatarUrl={c.avatarUrl ? getFileUrl(c.avatarUrl) : null} colors={colors} />
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
              </ScrollView>

              <Pressable
                style={[styles.saveBtn, { backgroundColor: colors.accent }, saving && { opacity: 0.7 }]}
                onPress={handleSaveContacts}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>Confirm ({selectedIds.size} selected)</Text>
                }
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
    maxHeight: "80%",
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  optionBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 12,
  },
  optBtnIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  optBtnText: { flex: 1 },
  optBtnLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  optBtnSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  skipBtn: { alignItems: "center", paddingTop: 8 },
  skipText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  contactList: { maxHeight: 300, marginBottom: 16 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
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
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 16 },
  emptyText: { textAlign: "center", padding: 20, fontFamily: "Inter_400Regular", fontSize: 14 },
});
