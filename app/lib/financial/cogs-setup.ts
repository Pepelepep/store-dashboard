export function formatRelativeUpdatedAt(
  value: string | null,
  now = new Date(),
) {
  if (!value) return "Updated time unavailable";

  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return "Updated time unavailable";

  const elapsedMs = Math.max(now.getTime() - updatedAt.getTime(), 0);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);

  if (elapsedMinutes < 1) return "Updated just now";
  if (elapsedMinutes < 60) {
    return `Updated ${elapsedMinutes} ${
      elapsedMinutes === 1 ? "minute" : "minutes"
    } ago`;
  }

  const elapsedHours = Math.floor(elapsedMs / 3_600_000);
  if (elapsedHours < 24) {
    return `Updated ${elapsedHours} ${
      elapsedHours === 1 ? "hour" : "hours"
    } ago`;
  }
  if (elapsedHours < 48) return "Updated yesterday";

  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  return `Updated ${elapsedDays} days ago`;
}
