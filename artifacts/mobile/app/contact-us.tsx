import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  Linking,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";

function ContactRow({
  icon,
  label,
  value,
  onPress,
  colors,
  last,
}: {
  icon: string;
  label: string;
  value: string;
  onPress: () => void;
  colors: any;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.surfaceAlt },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.accent + "22" }]}>
        <Feather name={icon as any} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
          {label}
        </Text>
        <Text style={[styles.rowValue, { color: colors.text, fontFamily: "Inter_500Medium" }]}>
          {value}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: any }) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
      {title}
    </Text>
  );
}

const openLink = (url: string) => {
  Linking.canOpenURL(url).then((supported) => {
    if (supported) {
      Linking.openURL(url);
    } else {
      Alert.alert("Error", "Unable to open this link on your device.");
    }
  });
};

export default function ContactUsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Contact Us</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.companyCard, { backgroundColor: colors.accent + "15", borderColor: colors.accent + "33" }]}>
          <View style={[styles.companyIconWrap, { backgroundColor: colors.accent }]}>
            <Feather name="briefcase" size={28} color="#fff" />
          </View>
          <Text style={[styles.companyName, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
            Bluegold.ltd
          </Text>
          <Text style={[styles.companyTagline, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            We're here to help. Reach out anytime.
          </Text>
        </View>

        <SectionHeader title="PHONE" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ContactRow
            icon="phone"
            label="Primary"
            value="+260 965 335 385"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              openLink("tel:+260965335385");
            }}
            colors={colors}
          />
          <ContactRow
            icon="phone"
            label="Secondary"
            value="+260 771 523 503"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              openLink("tel:+260771523503");
            }}
            colors={colors}
            last
          />
        </View>

        <SectionHeader title="WHATSAPP" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ContactRow
            icon="message-circle"
            label="WhatsApp"
            value="+260 965 335 385"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              openLink("https://wa.me/260965335385");
            }}
            colors={colors}
            last
          />
        </View>

        <SectionHeader title="EMAIL" colors={colors} />
        <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ContactRow
            icon="mail"
            label="Email"
            value="mwendachabota0@gmail.com"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              openLink("mailto:mwendachabota0@gmail.com");
            }}
            colors={colors}
            last
          />
        </View>

        <Text style={[styles.footer, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
          © 2025 Bluegold.ltd. All rights reserved.
        </Text>
      </ScrollView>
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
  backBtn: { width: 40, alignItems: "flex-start" },
  headerTitle: { fontSize: 20 },
  scroll: { padding: 16, gap: 8 },
  companyCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  companyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  companyName: { fontSize: 24 },
  companyTagline: { fontSize: 14, textAlign: "center" },
  sectionHeader: {
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 11, marginBottom: 2 },
  rowValue: { fontSize: 15 },
  footer: {
    textAlign: "center",
    fontSize: 12,
    marginTop: 16,
  },
});
