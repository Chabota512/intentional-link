import { Alert, Platform } from "react-native";

export function confirmAction(
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void,
  destructive = true
) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
  } else {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: confirmText, style: destructive ? "destructive" : "default", onPress: onConfirm },
    ]);
  }
}
