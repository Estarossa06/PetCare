import type { KiraiMessage } from "./storage";

/** Merge a server page with locally saved deliveries the server has not confirmed yet. */
export function mergeKiraiMessagePage(remote: KiraiMessage[], local: KiraiMessage[]): KiraiMessage[] {
  const merged = new Map(remote.map((message) => [message.id, message]));
  const remoteRequestIds = new Set(remote.flatMap((message) => message.requestId ? [message.requestId] : []));

  for (const message of local) {
    if (message.role !== "user" || (message.requestStatus !== "pending" && message.requestStatus !== "failed")) continue;
    if (merged.has(message.id) || (message.requestId && remoteRequestIds.has(message.requestId))) continue;
    merged.set(message.id, message);
  }

  return [...merged.values()].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    if (byTime !== 0) return byTime;
    if (left.role !== right.role) return left.role === "user" ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

export function kiraiDeliveryLabel(message: KiraiMessage, sendingRequestId: string | null): string | null {
  if (message.role !== "user") return null;
  if (message.requestId && message.requestId === sendingRequestId) return "Enviando…";
  if (message.requestStatus === "pending") return "Pendiente";
  if (message.requestStatus === "failed") return "No se envió";
  if (message.requestStatus === "complete") return "Enviado";
  return null;
}
