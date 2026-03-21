import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  Image,
  Dimensions,
  Linking,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";
import { formatRelative } from "@/utils/date";

interface MediaItem {
  id: number;
  type: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  senderId: number;
  createdAt: string;
  sender: { id: number; name: string; username: string; avatarUrl?: string | null } | null;
}

interface MediaResponse {
  images: MediaItem[];
  files: MediaItem[];
  voiceNotes: MediaItem[];
  total: number;
}

type Tab = "images" | "files";

const SCREEN_WIDTH = Dimensions.get("window").width;
const IMAGE_SIZE = (SCREEN_WIDTH - 48 - 8) / 3;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaGalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = parseInt(id, 10);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { get, getFileUrl } = useApi();
  const [activeTab, setActiveTab] = useState<Tab>("images");
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  const { data, isLoading } = useQuery<MediaResponse>({
    queryKey: ["media", sessionId],
    queryFn: () => get(`/sessions/${sessionId}/media?limit=100`),
  });

  const images = data?.images ?? [];
  const files = [...(data?.files ?? []), ...(data?.voiceNotes ?? [])];

  const topPad = insets.top + (Platform.OS === "web" ? 16 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const renderImage = ({ item }: { item: MediaItem }) => {
    const url = item.attachmentUrl ? getFileUrl(item.attachmentUrl) : null;
    if (!url) return null;
    return (
      <Pressable
        style={({ pressed }) => [styles.imageThumb, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setViewerImage(url);
        }}
      >
        <Image source={{ uri: url }} style={styles.imageThumbImg} resizeMode="cover" />
      </Pressable>
    );
  };

  const renderFile = ({ item }: { item: MediaItem }) => {
    const url = item.attachmentUrl ? getFileUrl(item.attachmentUrl) : null;
    const isVoice = item.type === "voice";
    return (
      <Pressable
        style={({ pressed }) => [styles.fileCard, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
        onPress={() => {
          if (url) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Linking.openURL(url);
          }
        }}
      >
        <View style={[styles.fileIcon, { backgroundColor: isVoice ? "#FFF3E0" : colors.accentSoft }]}>
          <Feather name={isVoice ? "mic" : "file"} size={18} color={isVoice ? "#FF9800" : colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fileName, { color: colors.text, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
            {item.attachmentName || (isVoice ? "Voice note" : "File")}
          </Text>
          <Text style={[styles.fileMeta, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
            {item.sender?.name ?? "Unknown"} · {formatRelative(item.createdAt)}
            {item.attachmentSize ? ` · ${formatFileSize(item.attachmentSize)}` : ""}
          </Text>
        </View>
        <Feather name="download" size={16} color={colors.accent} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Pressable style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
          Media & Files
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        <Pressable
          style={[styles.tab, activeTab === "images" && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("images")}
        >
          <Feather name="image" size={16} color={activeTab === "images" ? colors.accent : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === "images" ? colors.accent : colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
            Photos ({images.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "files" && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab("files")}
        >
          <Feather name="file" size={16} color={activeTab === "files" ? colors.accent : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === "files" ? colors.accent : colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
            Files ({files.length})
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : activeTab === "images" ? (
        images.length === 0 ? (
          <View style={styles.center}>
            <Feather name="image" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              No photos shared yet
            </Text>
          </View>
        ) : (
          <FlatList
            data={images}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderImage}
            numColumns={3}
            contentContainerStyle={[styles.imageGrid, { paddingBottom: bottomPad + 20 }]}
            columnWrapperStyle={{ gap: 4 }}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : files.length === 0 ? (
        <View style={styles.center}>
          <Feather name="file" size={40} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            No files shared yet
          </Text>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderFile}
          contentContainerStyle={[styles.fileList, { paddingBottom: bottomPad + 20 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal visible={viewerImage !== null} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <Pressable style={styles.viewerOverlay} onPress={() => setViewerImage(null)}>
          <Pressable style={styles.viewerCloseBtn} onPress={() => setViewerImage(null)}>
            <Feather name="x" size={24} color="#fff" />
          </Pressable>
          {viewerImage && (
            <Image source={{ uri: viewerImage }} style={styles.viewerImage} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 16 },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  tabText: { fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 14 },
  imageGrid: { padding: 16, gap: 4 },
  imageThumb: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: 8,
    overflow: "hidden",
  },
  imageThumbImg: { width: "100%", height: "100%", borderRadius: 8 },
  fileList: { padding: 12, gap: 8 },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  fileName: { fontSize: 14 },
  fileMeta: { fontSize: 12, marginTop: 2 },
  viewerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerCloseBtn: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  viewerImage: {
    width: SCREEN_WIDTH - 32,
    height: SCREEN_WIDTH - 32,
  },
});
