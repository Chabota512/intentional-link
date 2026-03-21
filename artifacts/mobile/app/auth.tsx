import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

const appIcon = require("../assets/images/icon.png");

export default function AuthScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const nameRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (error) {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setError(""), 3500);
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  const passwordStrength = password.length === 0
    ? null
    : password.length < 6
    ? "weak"
    : password.length < 10
    ? "fair"
    : "strong";

  const strengthColor = {
    weak: colors.danger,
    fair: "#F59E0B",
    strong: colors.success,
  };

  const isFormValid = mode === "login"
    ? username.trim().length > 0 && password.trim().length > 0
    : name.trim().length > 0 && username.trim().length > 0 && password.length >= 6;

  const getValidationError = () => {
    if (mode === "register" && !name.trim()) return "Please enter your full name";
    if (!username.trim()) return "Please enter your username";
    if (!password.trim()) return "Please enter your password";
    if (mode === "register" && password.length < 6) return "Password must be at least 6 characters";
    return null;
  };

  const handleSubmit = async () => {
    setError("");
    const validationError = getValidationError();
    if (validationError) {
      setError(validationError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), name.trim(), password);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/sessions");
    } catch (e: any) {
      setError(e.message || "Something went wrong");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: "login" | "register") => {
    setMode(newMode);
    setError("");
    setPassword("");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 60), paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(400).delay(0)} style={styles.header}>
            <View style={[styles.logoContainer, { backgroundColor: colors.accent }]}>
              <Image source={appIcon} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={[styles.appName, { color: colors.text, fontFamily: "Inter_700Bold" }]}>Intentional Link</Text>
            <Text style={[styles.tagline, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
              Intentional communication
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(500).springify()} style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.fields}>
              <Text style={[styles.cardTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
                {mode === "login" ? "Welcome back" : "Create account"}
              </Text>
              <Text style={[styles.cardSubtitle, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                {mode === "login" ? "Sign in to continue" : "Join to get started"}
              </Text>
              {mode === "register" && (
                <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <Feather name="user" size={18} color={colors.textSecondary} />
                  <TextInput
                    ref={nameRef}
                    style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                    placeholder="Full name"
                    placeholderTextColor={colors.textTertiary}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => usernameRef.current?.focus()}
                  />
                </View>
              )}

              <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Feather name="at-sign" size={18} color={colors.textSecondary} />
                <TextInput
                  ref={usernameRef}
                  style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                  placeholder="Username or name"
                  placeholderTextColor={colors.textTertiary}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>

              <View>
                <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                  <Feather name="lock" size={18} color={colors.textSecondary} />
                  <TextInput
                    ref={passwordRef}
                    style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                    placeholder="Password"
                    placeholderTextColor={colors.textTertiary}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.textTertiary} />
                  </Pressable>
                </View>
                {mode === "register" && password.length > 0 && (
                  <View style={styles.strengthRow}>
                    <View style={styles.strengthBars}>
                      {["weak", "fair", "strong"].map((level, i) => {
                        const levels = ["weak", "fair", "strong"];
                        const idx = levels.indexOf(passwordStrength ?? "");
                        const filled = i <= idx;
                        return (
                          <View
                            key={level}
                            style={[
                              styles.strengthBar,
                              {
                                backgroundColor: filled
                                  ? strengthColor[passwordStrength as keyof typeof strengthColor]
                                  : colors.border,
                              },
                            ]}
                          />
                        );
                      })}
                    </View>
                    <Text style={[styles.strengthLabel, {
                      color: strengthColor[passwordStrength as keyof typeof strengthColor] ?? colors.textTertiary,
                      fontFamily: "Inter_500Medium",
                    }]}>
                      {passwordStrength === "weak" ? "Too short" : passwordStrength === "fair" ? "Fair" : "Strong"}
                    </Text>
                  </View>
                )}
                {mode === "register" && (
                  <Text style={[styles.passwordHint, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                    Minimum 6 characters
                  </Text>
                )}
              </View>

              {error !== "" && (
                <View style={[styles.errorBox, { backgroundColor: colors.warning + "22", borderColor: colors.warning }]}>
                  <Feather name="info" size={14} color={colors.warning} />
                  <Text style={[styles.errorText, { color: colors.text, fontFamily: "Inter_400Regular" }]}>{error}</Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: isFormValid ? colors.accent : colors.textTertiary,
                    opacity: loading ? 0.7 : pressed ? 0.85 : 1,
                    shadowOpacity: isFormValid ? 0.3 : 0,
                    elevation: isFormValid ? 5 : 0,
                  },
                ]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                    {mode === "login" ? "Sign In" : "Create Account"}
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.switchLink, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => switchMode(mode === "login" ? "register" : "login")}
              >
                <Text style={[styles.switchLinkText, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                  {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                  <Text style={{ color: colors.accent, fontFamily: "Inter_600SemiBold" }}>
                    {mode === "login" ? "Sign up" : "Sign in"}
                  </Text>
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  header: { alignItems: "center", marginBottom: 40, gap: 12 },
  logoContainer: {
    width: 88,
    height: 88,
    borderRadius: 22,
    overflow: "hidden",
    shadowColor: "#4BA896",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  logoImage: {
    width: 88,
    height: 88,
    borderRadius: 22,
  },
  appName: { fontSize: 32 },
  tagline: { fontSize: 15, letterSpacing: 0.3 },
  card: {
    borderRadius: 28,
    overflow: "hidden",
    shadowColor: "#4BA896",
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.18,
    shadowRadius: 48,
    elevation: 18,
  },
  fields: { padding: 28, gap: 14 },
  cardTitle: { fontSize: 24, marginBottom: 2 },
  cardSubtitle: { fontSize: 14, marginBottom: 6 },
  switchLink: { alignItems: "center", paddingVertical: 4, marginTop: 4 },
  switchLinkText: { fontSize: 14 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 15,
    gap: 10,
  },
  input: { flex: 1, fontSize: 15 },
  strengthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  strengthBars: { flexDirection: "row", gap: 4, flex: 1 },
  strengthBar: { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel: { fontSize: 11 },
  passwordHint: { fontSize: 11, marginTop: 4, paddingHorizontal: 2 },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 6,
    shadowColor: "#4BA896",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 6,
  },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13 },
});
