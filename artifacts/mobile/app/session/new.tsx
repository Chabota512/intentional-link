import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useApi } from "@/hooks/useApi";

export default function NewSessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { post } = useApi();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: (data: { title: string; description?: string }) => post("/sessions", data),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.dismiss();
      router.push(`/session/${session.id}`);
    },
  });

  const handleCreate = () => {
    if (!title.trim()) return;
    mutation.mutate({ title: title.trim(), description: description.trim() || undefined });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.dismiss()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Feather name="x" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
            New Session
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.createBtn,
              { backgroundColor: title.trim() ? colors.accent : colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleCreate}
            disabled={!title.trim() || mutation.isPending}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.createBtnText, { fontFamily: "Inter_600SemiBold" }]}>Create</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.iconRow, { backgroundColor: colors.accentSoft }]}>
            <Feather name="zap" size={28} color={colors.accent} />
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
            Give your session a clear name so everyone stays focused.
          </Text>

          <Text style={[styles.label, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
            SESSION TITLE
          </Text>
          <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
              placeholder="e.g., Q3 Planning, Design Review…"
              placeholderTextColor={colors.textTertiary}
              value={title}
              onChangeText={setTitle}
              autoFocus
              returnKeyType="next"
              maxLength={100}
            />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary, fontFamily: "Inter_500Medium" }]}>
            DESCRIPTION (optional)
          </Text>
          <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border, minHeight: 100 }]}>
            <TextInput
              style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular", textAlignVertical: "top" }]}
              placeholder="What is this session about?"
              placeholderTextColor={colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
          </View>

          {mutation.isError && (
            <View style={[styles.errorBox, { backgroundColor: "#FFF0F0", borderColor: colors.danger }]}>
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "Inter_400Regular" }]}>
                {(mutation.error as Error).message}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16 },
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 72,
    alignItems: "center",
  },
  createBtnText: { color: "#fff", fontSize: 14 },
  content: { padding: 20, gap: 12 },
  iconRow: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 4,
  },
  hint: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 12 },
  label: { fontSize: 11, letterSpacing: 0.8 },
  inputWrapper: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  input: { fontSize: 16, lineHeight: 24 },
  errorBox: { padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13 },
});
