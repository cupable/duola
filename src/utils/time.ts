export function parseLookbackToSeconds(input: string): number {
  const value = input.trim().toLowerCase();
  const match = value.match(/^(\d+)([smhd])$/);

  if (!match) {
    throw new Error(`Invalid duration: ${input}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 3600;
    case "d":
      return amount * 86400;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}

export function formatTimestamp(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null;
  }

  const millis = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(millis).toISOString();
}
