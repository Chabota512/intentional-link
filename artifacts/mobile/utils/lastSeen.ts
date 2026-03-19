export function formatLastSeen(lastSeenAt: string | Date | null | undefined): string {
  if (!lastSeenAt) return "Never";
  const date = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function isOnline(lastSeenAt: string | Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const date = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  return Date.now() - date.getTime() < 3 * 60 * 1000;
}
