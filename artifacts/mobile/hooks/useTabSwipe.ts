import { useRef } from "react";
import { PanResponder } from "react-native";
import { usePathname, router } from "expo-router";
import * as Haptics from "expo-haptics";

const TAB_ROUTES = ["sessions", "contacts", "activity", "profile"] as const;
const EMPTY_HANDLERS = {};

export function useTabSwipe({ disabled = false }: { disabled?: boolean } = {}) {
  const pathname = usePathname();
  const currentTab = TAB_ROUTES.find(t => pathname === `/${t}` || pathname.startsWith(`/${t}/`)) || TAB_ROUTES[0];
  const currentIndex = TAB_ROUTES.indexOf(currentTab as typeof TAB_ROUTES[number]);
  const indexRef = useRef(currentIndex);
  const disabledRef = useRef(disabled);
  indexRef.current = currentIndex;
  disabledRef.current = disabled;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => {
        if (disabledRef.current) return false;
        return Math.abs(gs.dx) > 30 && Math.abs(gs.dx) > Math.abs(gs.dy) * 2.5;
      },
      onPanResponderRelease: (_, gs) => {
        if (disabledRef.current) return;
        const idx = indexRef.current;
        let nextIndex = idx;
        if (gs.dx < -60 && gs.vx < -0.2) nextIndex = idx + 1;
        else if (gs.dx > 60 && gs.vx > 0.2) nextIndex = idx - 1;
        if (nextIndex !== idx && nextIndex >= 0 && nextIndex < TAB_ROUTES.length) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.navigate(`/(tabs)/${TAB_ROUTES[nextIndex]}` as any);
        }
      },
    })
  ).current;

  if (disabled) return EMPTY_HANDLERS;
  return panResponder.panHandlers;
}
