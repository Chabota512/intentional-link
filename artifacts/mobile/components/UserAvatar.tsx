import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

function resolveAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  return `${BASE_URL}${avatarUrl}`;
}

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  backgroundColor?: string;
  textColor?: string;
  style?: any;
  isOnline?: boolean;
  showDot?: boolean;
}

export default function UserAvatar({
  name,
  avatarUrl,
  size = 40,
  backgroundColor,
  textColor,
  style,
  isOnline,
  showDot = true,
}: UserAvatarProps) {
  const { colors } = useTheme();
  const resolvedUrl = resolveAvatarUrl(avatarUrl);
  const initial = (name || "?").charAt(0).toUpperCase();
  const fontSize = Math.round(size * 0.38);
  const dotSize = Math.max(8, Math.round(size * 0.22));
  const dotBorder = Math.max(1.5, Math.round(size * 0.04));

  return (
    <View style={[{ width: size, height: size, position: "relative" }, style]}>
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: backgroundColor ?? colors.accentSoft,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}>
        {resolvedUrl ? (
          <Image
            source={{ uri: resolvedUrl }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize, color: textColor ?? colors.accent, fontFamily: "Inter_600SemiBold" }}>
            {initial}
          </Text>
        )}
      </View>
      {showDot && isOnline !== undefined && (
        <View style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: isOnline ? colors.success : colors.textTertiary,
          borderWidth: dotBorder,
          borderColor: colors.surface,
        }} />
      )}
    </View>
  );
}
