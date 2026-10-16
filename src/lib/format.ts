export function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function greeting(now: number): string {
  const h = new Date(now).getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Snooze presets computed from the current time. */
export function snoozeOptions(now: number) {
  const d = new Date(now);
  const at = (days: number, hour: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    x.setHours(hour, 0, 0, 0);
    return x.getTime();
  };
  const daysToMonday = ((8 - d.getDay()) % 7) || 7;
  return [
    { label: "In 3 hours", until: now + 3 * 3_600_000 },
    { label: "This evening", until: d.getHours() < 18 ? at(0, 18) : at(1, 18) },
    { label: "Tomorrow morning", until: at(1, 8) },
    { label: "Next Monday", until: at(daysToMonday, 8) },
  ];
}
