/**
 * The address a request comes from, behind Fly's proxy: the first entry of an
 * X-Forwarded-For list (Colyseus hands it over as a string, a list, or the
 * socket's own address), without the IPv4-in-IPv6 prefix. "unknown" when there
 * is none, so the limits (util/limits.ts) still count something.
 */
export function clientIp(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "unknown";
  const first = raw.split(",")[0].trim().replace(/^::ffff:/i, "");
  return first || "unknown";
}
