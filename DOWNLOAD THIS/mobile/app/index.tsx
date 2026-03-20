import { useAuth } from "@/context/AuthContext";
import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useTheme } from "@/hooks/useTheme";

export default function Index() {
  const { user, isLoading } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (user) {
    return <Redirect href="/(tabs)/sessions" />;
  }

  return <Redirect href="/auth" />;
}
