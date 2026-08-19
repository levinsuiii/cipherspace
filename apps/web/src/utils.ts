export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function shortenOpaqueValue(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return value.length > 22 ? `${value.slice(0, 22)}…` : value;
}
