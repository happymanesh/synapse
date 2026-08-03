/** Matches an IP against a dotted pattern that allows `*` wildcard octets, e.g. `192.168.*.*`. */
export function ipMatchesPattern(ip: string, pattern: string): boolean {
  const patternParts = pattern.split(".");
  const ipParts = ip.split(".");
  if (patternParts.length !== 4 || ipParts.length !== 4) return false;

  return patternParts.every((part, i) => part === "*" || part === ipParts[i]);
}

interface IpMappingRow {
  ipMapping: string;
  isActive: boolean;
}

/** No active mapping rows for a user means unrestricted access; otherwise the IP must match one. */
export function isIpAllowed(ip: string, mappings: IpMappingRow[]): boolean {
  const activeMappings = mappings.filter((m) => m.isActive);
  if (activeMappings.length === 0) return true;
  return activeMappings.some((m) => ipMatchesPattern(ip, m.ipMapping));
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}
