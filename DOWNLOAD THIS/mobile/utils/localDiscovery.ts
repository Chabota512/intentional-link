export type PresenceStatus = "local" | "online" | "offline";

export interface LocalDiscoveryHandle {
  stop: () => void;
}

export function startLocalDiscovery(
  _userId: number,
  _onPeersChange: (peerIds: Set<number>) => void
): LocalDiscoveryHandle {
  return { stop: () => {} };
}

export const isLocalDiscoverySupported = false;
