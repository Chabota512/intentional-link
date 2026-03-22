import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useTabSwipe } from "@/hooks/useTabSwipe";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import {
  useNotifications,
  useMarkNotifRead,
  useMarkAllNotifsRead,
  type AppNotification,
} from "@/hooks/useNotifications";
import { formatRelative } from "@/utils/date";

function getNotifIcon(type: AppNotification["type"]) {
  if (type === "call") return "phone";
  if (type === "invite") return "user-plus";
  if (type === "contact_request") return "user-plus";
  if (type === "contact_accepted") return "check-circle";
  if (type === "dnd_ending") return "moon";
  if (type === "chat_completed") return "check-square";
  return "message-circle";
}

function getNotifColor(type: AppNotification["type"], colors: any) {
  if (type === "call") return colors.success;
  if (type === "invite") return colors.accent;
  if (type === "contact_request") return colors.accent;
  if (type === "contact_accepted") return colors.success;
  if (type === "dnd_ending") return "#8B5CF6";
  if (type === "chat_completed") return colors.textSecondary;
  return colors.accent;
}

function NotifItem({
  notif,
  colors,
  onPress,
}: {
  notif: AppNotification;
  colors: any;
  onPress: () => void;
}) {
  const iconName = getNotifIcon(notif.type);
  const iconColor = getNotifColor(notif.type, colors);

  return (
    <Animated.View entering={FadeInDown.duration(180)}>
      <Pressable
        style={({ pressed }) => [
          styles.item,
          {
            backgroundColor: notif.isRead ? colors.background : colors.surfaceAlt,
            borderBottomColor: colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
        onPress={onPress}
      >
        <View style={[styles.iconWrap, { backgroundColor: `${iconColor}18` }]}>
          <Feather name={iconName as any} size={18} color={iconColor} />
        </View>
        <View style={styles.itemContent}>
          <View style={styles.itemHeader}>
            <Text
              style={[
                styles.itemTitle,
                {
                  color: colors.text,
                  fontFamily: notif.isRead ? "Inter_400Regular" : "Inter_600SemiBold",
                },
              ]}
              numberOfLines={1}
            >
              {notif.title}
            </Text>
            <Text style={[styles.itemTime, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
              {formatRelative(notif.createdAt)}
            </Text>
          </View>
          <Text
            style={[styles.itemBody, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}
            numberOfLines={2}
          >
            {notif.body}
          </Text>
        </View>
        {!notif.isRead && (
          <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />
        )}
      </Pressable>
    </Animated.View>
  );
}

export default function ActivityScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const swipeHandlers = useTabSwipe();
  const { data, isLoading, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotifRead();
  const markAllRead = useMarkAllNotifsRead();

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const handlePress = useCallback(
    (notif: AppNotification) => {
      if (!notif.isRead) {
        markRead.mutate(notif.id);
      }
      const sessionId = notif.data?.sessionId;
      if (notif.type === "contact_request" || notif.type === "contact_accepted") {
        router.push("/contacts" as any);
      } else if (notif.type === "dnd_ending") {
        router.push("/notifications-settings" as any);
      } else if (sessionId) {
        router.push(`/session/${sessionId}` as any);
      }
    },
    [markRead]
  );

  const handleMarkAll = useCallback(() => {
    markAllRead.mutate();
  }, [markAllRead]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...swipeHandlers}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
          Activity
        </Text>
        {unreadCount > 0 && (
          <Pressable
            style={({ pressed }) => [styles.markAllBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={handleMarkAll}
            disabled={markAllRead.isPending}
          >
            <Text style={[styles.markAllText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Feather name="bell" size={32} color={colors.textTertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
            No activity yet
          </Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            Messages, calls, contact requests, and chat updates will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <NotifItem notif={item} colors={colors} onPress={() => handlePress(item)} />
          )}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            unreadCount > 0 ? (
              <View style={[styles.unreadBanner, { backgroundColor: colors.accentSoft }]}>
                <Feather name="bell" size={13} color={colors.accent} />
                <Text style={[styles.unreadBannerText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>
                  {unreadCount} unread {unreadCount === 1 ? "notification" : "notifications"}
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 26,
    letterSpacing: -0.5,
  },
  markAllBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  markAllText: {
    fontSize: 14,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 260,
  },
  unreadBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  unreadBannerText: {
    fontSize: 13,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
    gap: 3,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    flex: 1,
  },
  itemTime: {
    fontSize: 11,
    flexShrink: 0,
  },
  itemBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
});
