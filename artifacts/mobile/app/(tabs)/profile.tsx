import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  ScrollView,
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
  const { user, logout } = useAuth();

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

  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 20, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Profile</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 28, lineHeight: 34 },
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
});
