import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { startLocalDiscovery, isLocalDiscoverySupported } from "@/utils/localDiscovery";
import type { PresenceStatus } from "@/utils/localDiscovery";

export type { PresenceStatus };

interface LocalDiscoveryContextValue {
  localPeerIds: Set<number>;
  isSupported: boolean;
  getPresenceStatus: (userId: number, lastSeenAt: string | null | undefined) => PresenceStatus;
}

const LocalDiscoveryContext = createContext<LocalDiscoveryContextValue>({
  localPeerIds: new Set(),
  isSupported: false,
  getPresenceStatus: () => "offline",
});

const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

function checkInternetOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

export function LocalDiscoveryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [localPeerIds, setLocalPeerIds] = useState<Set<number>>(new Set());
  const handleRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!user) {
      handleRef.current?.stop();
      handleRef.current = null;
      setLocalPeerIds(new Set());
      return;
    }

    handleRef.current?.stop();

    const handle = startLocalDiscovery(user.id, (ids) => {
      setLocalPeerIds(ids);
    });
    handleRef.current = handle;

    return () => {
      handle.stop();
      handleRef.current = null;
    };
  }, [user?.id]);

  const getPresenceStatus = (
    userId: number,
    lastSeenAt: string | null | undefined
  ): PresenceStatus => {
    if (localPeerIds.has(userId)) return "local";
    if (checkInternetOnline(lastSeenAt)) return "online";
    return "offline";
  };

  return (
    <LocalDiscoveryContext.Provider
      value={{ localPeerIds, isSupported: isLocalDiscoverySupported, getPresenceStatus }}
    >
      {children}
    </LocalDiscoveryContext.Provider>
  );
}

export function useLocalDiscovery() {
  return useContext(LocalDiscoveryContext);
}
