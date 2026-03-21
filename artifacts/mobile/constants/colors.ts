const accent = "#3E93AC";
const accentDark = "#4AAEC8";
const success = "#34C759";
const danger = "#FF3B30";
const warning = "#FF9500";

export default {
  light: {
    background: "#EEF3F8",
    surface: "#FFFFFF",
    surfaceAlt: "#E8F1F8",
    border: "#D6E8F2",
    text: "#0D1820",
    textSecondary: "#4D6E7E",
    textTertiary: "#8BAFC2",
    accent,
    accentSoft: "#DFF0F7",
    success,
    danger,
    warning,
    tint: accent,
    tabIconDefault: "#8BAFC2",
    tabIconSelected: accent,
    headerBg: "#FFFFFF",
    messageBubbleOwn: accent,
    messageBubbleOther: "#FFFFFF",
    focusBadge: "#FFF3E0",
    focusBadgeText: warning,
  },
  dark: {
    background: "#0A1520",
    surface: "#121D2A",
    surfaceAlt: "#192638",
    border: "#1F2E42",
    text: "#EAF3F8",
    textSecondary: "#6AA3BB",
    textTertiary: "#3A5270",
    accent: accentDark,
    accentSoft: "#142438",
    success,
    danger,
    warning,
    tint: accentDark,
    tabIconDefault: "#3A5270",
    tabIconSelected: accentDark,
    headerBg: "#121D2A",
    messageBubbleOwn: accentDark,
    messageBubbleOther: "#192638",
    focusBadge: "#2A1F00",
    focusBadgeText: warning,
  },
};
