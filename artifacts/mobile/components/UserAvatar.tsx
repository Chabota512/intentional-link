import React from "react";
import { View, Text, Image } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { PresenceStatus } from "@/utils/localDiscovery";

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

const LOCAL_COLOR = "#7C3AED";

function resolveAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith("http")) return avatarUrl;
  return `${BASE_URL}${avatarUrl}`;
}

function dotColor(
  presenceStatus: PresenceStatus | undefined,
  isOnline: boolean | undefined,
  successColor: string,
  offlineColor: string
): string {
  if (presenceStatus === "local") return LOCAL_COLOR;
  if (presenceStatus === "online") return successColor;
  if (presenceStatus === "offline") return offlineColor;
  return isOnline ? successColor : offlineColor;
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
  presenceStatus?: PresenceStatus;
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
  presenceStatus,
}: UserAvatarProps) {
  const { colors } = useTheme();
  const resolvedUrl = resolveAvatarUrl(avatarUrl);
  const initial = (name || "?").charAt(0).toUpperCase();
  const fontSize = Math.round(size * 0.38);
  const dotSize = Math.max(8, Math.round(size * 0.22));
  const dotBorder = Math.max(1.5, Math.round(size * 0.04));

  const showPresenceDot = showDot;
  const dot = dotColor(presenceStatus, isOnline, colors.success, "#94A3B8");

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
      {showPresenceDot && (
        <View style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: dot,
          borderWidth: dotBorder,
          borderColor: colors.surface,
        }} />
      )}
    </View>
  );
}
