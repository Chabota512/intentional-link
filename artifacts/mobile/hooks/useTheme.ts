import { useColorScheme } from "react-native";
import Colors from "@/constants/colors";

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return { colors: isDark ? Colors.dark : Colors.light, isDark };
}
