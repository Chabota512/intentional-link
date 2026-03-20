const accent = "#4F6EF7";
const accentDark = "#6B85FF";
const success = "#34C759";
const danger = "#FF3B30";
const warning = "#FF9500";

export default {
  light: {
    background: "#F0F2F8",
    surface: "#FFFFFF",
    surfaceAlt: "#F7F8FC",
    border: "#E4E8F0",
    text: "#0A0E1A",
    textSecondary: "#6B7280",
    textTertiary: "#9CA3AF",
    accent,
    accentSoft: "#EEF1FE",
    success,
    danger,
    warning,
    tint: accent,
    tabIconDefault: "#9CA3AF",
    tabIconSelected: accent,
    headerBg: "#FFFFFF",
    messageBubbleOwn: accent,
    messageBubbleOther: "#FFFFFF",
    focusBadge: "#FFF3E0",
    focusBadgeText: warning,
  },
  dark: {
    background: "#0A0E1A",
    surface: "#141929",
    surfaceAlt: "#1C2338",
    border: "#252D42",
    text: "#F1F3FA",
    textSecondary: "#8896B3",
    textTertiary: "#4A5568",
    accent: accentDark,
    accentSoft: "#1A2040",
    success,
    danger,
    warning,
    tint: accentDark,
    tabIconDefault: "#4A5568",
    tabIconSelected: accentDark,
    headerBg: "#141929",
    messageBubbleOwn: accentDark,
    messageBubbleOther: "#1C2338",
    focusBadge: "#2A1F00",
    focusBadgeText: warning,
  },
};
