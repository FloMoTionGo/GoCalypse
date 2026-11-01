/**
 * The address a request comes from. Behind Fly's proxy, Fly-Client-IP is the
 * one header a client cannot write (Fly sets it; X-Forwarded-For it only
 * appends to, so a client may put anything in front). Without it: the first
 * entry of the forwarded list Colyseus hands over (a string, a list, or the
 * socket's own address), without the IPv4-in-IPv6 prefix. "unknown" when
 * there is nothing, so the limits (util/limits.ts) still count something.
 */
export function clientIp(value: unknown, headers?: Record<string, unknown>): string {
  const fly = headers?.["fly-client-ip"];
  const raw = typeof fly === "string" && fly.trim() ? fly : Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "unknown";
  const first = raw.split(",")[0].trim().replace(/^::ffff:/i, "");
  return first || "unknown";
}
