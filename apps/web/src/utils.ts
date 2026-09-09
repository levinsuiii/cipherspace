export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
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

export function workspaceRoleLabel(role: "owner" | "editor" | "viewer"): string {
  if (role === "owner") return "Besitzer";
  if (role === "editor") return "Editor";
  return "Leser";
}
