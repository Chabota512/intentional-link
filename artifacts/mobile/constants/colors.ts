const accent = "#4BA896";
const accentDark = "#5BBBA8";
const success = "#34C759";
const danger = "#FF3B30";
const warning = "#FF9500";

export default {
  light: {
    background: "#F0F5F3",
    surface: "#FFFFFF",
    surfaceAlt: "#F4FAF8",
    border: "#DFF0EC",
    text: "#0D1A17",
    textSecondary: "#5A7268",
    textTertiary: "#9CB8B1",
    accent,
    accentSoft: "#E6F4F1",
    success,
    danger,
    warning,
    tint: accent,
    tabIconDefault: "#9CB8B1",
    tabIconSelected: accent,
    headerBg: "#FFFFFF",
    messageBubbleOwn: accent,
    messageBubbleOther: "#FFFFFF",
    focusBadge: "#FFF3E0",
    focusBadgeText: warning,
  },
  dark: {
    background: "#0A1714",
    surface: "#121F1C",
    surfaceAlt: "#192B27",
    border: "#213530",
    text: "#EBF5F3",
    textSecondary: "#7AA89F",
    textTertiary: "#3D5C57",
    accent: accentDark,
    accentSoft: "#152E2A",
    success,
    danger,
    warning,
    tint: accentDark,
    tabIconDefault: "#3D5C57",
    tabIconSelected: accentDark,
    headerBg: "#121F1C",
    messageBubbleOwn: accentDark,
    messageBubbleOther: "#192B27",
    focusBadge: "#2A1F00",
    focusBadgeText: warning,
  },
};
