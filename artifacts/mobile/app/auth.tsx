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
  Modal,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";

const appIcon = require("../assets/images/icon.png");

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

const SECURITY_QUESTIONS = [
  "What is your mother's maiden name?",
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your favourite childhood movie?",
  "What was the name of your first school?",
  "What is your favourite food?",
  "What street did you grow up on?",
  "What is your best friend's first name?",
];

export default function AuthScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [showQuestionPicker, setShowQuestionPicker] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [forgotMode, setForgotMode] = useState<"idle" | "username" | "answer" | "newpass" | "done">("idle");
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotQuestion, setForgotQuestion] = useState("");
  const [forgotAnswer, setForgotAnswer] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotShowPassword, setForgotShowPassword] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const nameRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const securityAnswerRef = useRef<TextInput>(null);
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
    : name.trim().length > 0 && username.trim().length > 0 && password.length >= 6 && securityAnswer.trim().length >= 2;

  const getValidationError = () => {
    if (mode === "register" && !name.trim()) return "Please enter your full name";
    if (!username.trim()) return "Please enter your username";
    if (!password.trim()) return "Please enter your password";
    if (mode === "register" && password.length < 6) return "Password must be at least 6 characters";
    if (mode === "register" && securityAnswer.trim().length < 2) return "Please provide a security answer";
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
        await register(username.trim(), name.trim(), password, securityQuestion, securityAnswer.trim());
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
    setSecurityAnswer("");
  };

  const openForgotPassword = () => {
    setForgotMode("username");
    setForgotUsername("");
    setForgotQuestion("");
    setForgotAnswer("");
    setForgotNewPassword("");
    setForgotError("");
    setForgotShowPassword(false);
  };

  const handleForgotLookup = async () => {
    if (!forgotUsername.trim()) {
      setForgotError("Please enter your username");
      return;
    }
    setForgotLoading(true);
    setForgotError("");
    try {
      const res = await fetch(`${BASE_URL}/api/users/security-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForgotError(data.error || "Account not found");
        return;
      }
      setForgotQuestion(data.securityQuestion);
      setForgotMode("answer");
    } catch {
      setForgotError("Something went wrong. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotVerify = async () => {
    if (!forgotAnswer.trim()) {
      setForgotError("Please enter your answer");
      return;
    }
    setForgotMode("newpass");
    setForgotError("");
  };

  const handleForgotReset = async () => {
    if (forgotNewPassword.length < 6) {
      setForgotError("Password must be at least 6 characters");
      return;
    }
    setForgotLoading(true);
    setForgotError("");
    try {
      const res = await fetch(`${BASE_URL}/api/users/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: forgotUsername.trim(),
          securityAnswer: forgotAnswer.trim(),
          newPassword: forgotNewPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForgotError(data.error || "Reset failed");
        if (data.error !== "Too many attempts. Please try again later.") {
          setForgotMode("answer");
          setForgotAnswer("");
        }
        return;
      }
      setForgotMode("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setForgotError("Something went wrong. Please try again.");
    } finally {
      setForgotLoading(false);
    }
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
            { paddingTop: Math.max(insets.top, 20) + (Platform.OS === "web" ? 67 : 60), paddingBottom: insets.bottom + 40 },
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
                    returnKeyType={mode === "register" ? "next" : "done"}
                    onSubmitEditing={mode === "register" ? () => securityAnswerRef.current?.focus() : handleSubmit}
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

              {mode === "register" && (
                <>
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <Text style={[styles.sectionLabel, { color: colors.textSecondary, fontFamily: "Inter_600SemiBold" }]}>
                      Security Question
                    </Text>
                    <Text style={[styles.sectionHint, { color: colors.textTertiary, fontFamily: "Inter_400Regular" }]}>
                      Used to recover your account if you forget your password
                    </Text>
                    <Pressable
                      style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                      onPress={() => setShowQuestionPicker(true)}
                    >
                      <Feather name="help-circle" size={18} color={colors.textSecondary} />
                      <Text
                        style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                        numberOfLines={1}
                      >
                        {securityQuestion}
                      </Text>
                      <Feather name="chevron-down" size={18} color={colors.textTertiary} />
                    </Pressable>

                    <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                      <Feather name="shield" size={18} color={colors.textSecondary} />
                      <TextInput
                        ref={securityAnswerRef}
                        style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                        placeholder="Your answer"
                        placeholderTextColor={colors.textTertiary}
                        value={securityAnswer}
                        onChangeText={setSecurityAnswer}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={handleSubmit}
                      />
                    </View>
                  </View>
                </>
              )}

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

              {mode === "login" && (
                <Pressable
                  style={({ pressed }) => [styles.forgotLink, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={openForgotPassword}
                >
                  <Text style={[styles.forgotLinkText, { color: colors.accent, fontFamily: "Inter_500Medium" }]}>
                    Forgot password?
                  </Text>
                </Pressable>
              )}

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

      <Modal visible={showQuestionPicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowQuestionPicker(false)}>
          <View style={[styles.pickerCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.pickerTitle, { color: colors.text, fontFamily: "Inter_600SemiBold" }]}>
              Choose a security question
            </Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {SECURITY_QUESTIONS.map((q) => (
                <Pressable
                  key={q}
                  style={({ pressed }) => [
                    styles.pickerOption,
                    {
                      backgroundColor: q === securityQuestion ? colors.accentSoft : pressed ? colors.surfaceAlt : "transparent",
                    },
                  ]}
                  onPress={() => {
                    setSecurityQuestion(q);
                    setShowQuestionPicker(false);
                  }}
                >
                  <Text style={[styles.pickerOptionText, {
                    color: q === securityQuestion ? colors.accent : colors.text,
                    fontFamily: q === securityQuestion ? "Inter_600SemiBold" : "Inter_400Regular",
                  }]}>
                    {q}
                  </Text>
                  {q === securityQuestion && (
                    <Feather name="check" size={18} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={forgotMode !== "idle"} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setForgotMode("idle")}>
          <Pressable style={[styles.forgotCard, { backgroundColor: colors.surface }]} onPress={(e) => e.stopPropagation()}>
            {forgotMode === "done" ? (
              <View style={{ alignItems: "center", gap: 16, paddingVertical: 10 }}>
                <View style={[styles.successCircle, { backgroundColor: colors.success + "22" }]}>
                  <Feather name="check" size={32} color={colors.success} />
                </View>
                <Text style={[styles.forgotTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
                  Password Reset!
                </Text>
                <Text style={[styles.forgotSubtitle, { color: colors.textSecondary, fontFamily: "Inter_400Regular" }]}>
                  You can now sign in with your new password.
                </Text>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: colors.accent, width: "100%" }]}
                  onPress={() => setForgotMode("idle")}
                >
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>Back to Sign In</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Text style={[styles.forgotTitle, { color: colors.text, fontFamily: "Inter_700Bold" }]}>
                    {forgotMode === "username" ? "Reset Password" : forgotMode === "answer" ? "Security Question" : "New Password"}
                  </Text>
                  <Pressable onPress={() => setForgotMode("idle")} hitSlop={12}>
                    <Feather name="x" size={22} color={colors.textSecondary} />
                  </Pressable>
                </View>

                <Text style={[styles.forgotSubtitle, { color: colors.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 14 }]}>
                  {forgotMode === "username"
                    ? "Enter your username to look up your account."
                    : forgotMode === "answer"
                    ? forgotQuestion
                    : "Choose a new password (min. 6 characters)."}
                </Text>

                {forgotMode === "username" && (
                  <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <Feather name="at-sign" size={18} color={colors.textSecondary} />
                    <TextInput
                      style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                      placeholder="Username"
                      placeholderTextColor={colors.textTertiary}
                      value={forgotUsername}
                      onChangeText={setForgotUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleForgotLookup}
                    />
                  </View>
                )}

                {forgotMode === "answer" && (
                  <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <Feather name="shield" size={18} color={colors.textSecondary} />
                    <TextInput
                      style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                      placeholder="Your answer"
                      placeholderTextColor={colors.textTertiary}
                      value={forgotAnswer}
                      onChangeText={setForgotAnswer}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleForgotVerify}
                    />
                  </View>
                )}

                {forgotMode === "newpass" && (
                  <View style={[styles.inputWrapper, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <Feather name="lock" size={18} color={colors.textSecondary} />
                    <TextInput
                      style={[styles.input, { color: colors.text, fontFamily: "Inter_400Regular" }]}
                      placeholder="New password"
                      placeholderTextColor={colors.textTertiary}
                      value={forgotNewPassword}
                      onChangeText={setForgotNewPassword}
                      secureTextEntry={!forgotShowPassword}
                      returnKeyType="done"
                      onSubmitEditing={handleForgotReset}
                    />
                    <Pressable
                      onPress={() => setForgotShowPassword((v) => !v)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <Feather name={forgotShowPassword ? "eye-off" : "eye"} size={18} color={colors.textTertiary} />
                    </Pressable>
                  </View>
                )}

                {forgotError !== "" && (
                  <View style={[styles.errorBox, { backgroundColor: colors.warning + "22", borderColor: colors.warning, marginTop: 10 }]}>
                    <Feather name="info" size={14} color={colors.warning} />
                    <Text style={[styles.errorText, { color: colors.text, fontFamily: "Inter_400Regular" }]}>{forgotError}</Text>
                  </View>
                )}

                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 16, opacity: forgotLoading ? 0.7 : 1 }]}
                  onPress={forgotMode === "username" ? handleForgotLookup : forgotMode === "answer" ? handleForgotVerify : handleForgotReset}
                  disabled={forgotLoading}
                >
                  {forgotLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.primaryBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                      {forgotMode === "username" ? "Look Up Account" : forgotMode === "answer" ? "Verify Answer" : "Reset Password"}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
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
  sectionLabel: { fontSize: 13, letterSpacing: 0.2 },
  sectionHint: { fontSize: 11, marginBottom: 2 },
  switchLink: { alignItems: "center", paddingVertical: 4, marginTop: 4 },
  switchLinkText: { fontSize: 14 },
  forgotLink: { alignItems: "center", paddingVertical: 2 },
  forgotLinkText: { fontSize: 13 },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  pickerCard: {
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  pickerTitle: { fontSize: 18, marginBottom: 16 },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  pickerOptionText: { fontSize: 14, flex: 1, marginRight: 8 },
  forgotCard: {
    borderRadius: 24,
    padding: 28,
    width: "100%",
    maxWidth: 400,
  },
  forgotTitle: { fontSize: 20 },
  forgotSubtitle: { fontSize: 14 },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
  },
});
