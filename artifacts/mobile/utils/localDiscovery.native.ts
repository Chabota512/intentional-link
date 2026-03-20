import Zeroconf from "react-native-zeroconf";

export type PresenceStatus = "local" | "online" | "offline";

export interface LocalDiscoveryHandle {
  stop: () => void;
}

const SERVICE_TYPE = "focusapp";
const SERVICE_PROTOCOL = "tcp";
const DISCOVERY_PORT = 45678;
const SERVICE_PREFIX = "focus-user-";

export const isLocalDiscoverySupported = true;

export function startLocalDiscovery(
  userId: number,
  onPeersChange: (peerIds: Set<number>) => void
): LocalDiscoveryHandle {
  const zc = new Zeroconf();
  const localPeers = new Set<number>();
  const serviceName = `${SERVICE_PREFIX}${userId}`;

  const extractUserId = (name: string): number | null => {
    if (!name.startsWith(SERVICE_PREFIX)) return null;
    const id = parseInt(name.slice(SERVICE_PREFIX.length), 10);
    return isNaN(id) || id === userId ? null : id;
  };

  zc.on("found", (name: string) => {
    const peerId = extractUserId(name);
    if (peerId !== null) {
      localPeers.add(peerId);
      onPeersChange(new Set(localPeers));
    }
  });

  zc.on("remove", (name: string) => {
    const peerId = extractUserId(name);
    if (peerId !== null) {
      localPeers.delete(peerId);
      onPeersChange(new Set(localPeers));
    }
  });

  zc.on("error", (_err: Error) => {});

  try {
    zc.publishService(
      SERVICE_TYPE,
      SERVICE_PROTOCOL,
      "local.",
      serviceName,
      DISCOVERY_PORT,
      { userId: String(userId) }
    );
    zc.scan(SERVICE_TYPE, SERVICE_PROTOCOL, "local.");
  } catch {}

  return {
    stop: () => {
      try {
        zc.stop();
        zc.unpublishService(serviceName);
        zc.removeDeviceListeners();
      } catch {}
    },
  };
}
