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
}

export default function UserAvatar({
  name,
  avatarUrl,
  size = 40,
  backgroundColor,
  textColor,
  style,
}: UserAvatarProps) {
  const { colors } = useTheme();
  const resolvedUrl = resolveAvatarUrl(avatarUrl);
  const initial = (name || "?").charAt(0).toUpperCase();
  const fontSize = Math.round(size * 0.38);

  const circleStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: backgroundColor ?? colors.accentSoft,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };

  return (
    <View style={[circleStyle, style]}>
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
  );
}
