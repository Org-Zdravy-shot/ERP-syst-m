import { isIP } from "node:net";

function normalizeIpCandidate(value: string): string | null {
  let candidate = value.trim().replace(/^"|"$/g, "");
  if (!candidate) return null;

  if (candidate.startsWith("[")) {
    const bracket = candidate.indexOf("]");
    if (bracket > 1) candidate = candidate.slice(1, bracket);
  } else if (isIP(candidate) === 0) {
    const portSeparator = candidate.lastIndexOf(":");
    if (portSeparator > 0) {
      const withoutPort = candidate.slice(0, portSeparator);
      if (isIP(withoutPort) === 4) candidate = withoutPort;
    }
  }

  return isIP(candidate) > 0 ? candidate.toLowerCase() : null;
}

function ipv4Parts(value: string): number[] | null {
  const normalized = value.toLowerCase().startsWith("::ffff:")
    ? value.slice(7)
    : value;
  if (isIP(normalized) !== 4) return null;
  return normalized.split(".").map(Number);
}

function isPublicIp(value: string): boolean {
  const parts = ipv4Parts(value);
  if (parts) {
    const [a, b] = parts;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  const normalized = value.toLowerCase();
  if (isIP(normalized) !== 6) return false;
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

function forwardedCandidates(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map(normalizeIpCandidate)
    .filter((candidate): candidate is string => candidate !== null);
}

/**
 * Za reverzným proxy vyberá sprava poslednú verejnú adresu a preskakuje
 * interné proxy hop-y. Tým ignoruje prípadnú klientom podstrčenú adresu na
 * ľavej strane X-Forwarded-For. Surová hodnota sa nikdy nepersistuje.
 */
export function clientAddressFromHeaders(
  requestHeaders: Pick<Headers, "get">,
): string {
  const forwarded = forwardedCandidates(
    requestHeaders.get("x-forwarded-for"),
  );
  const publicForwarded = [...forwarded].reverse().find(isPublicIp);
  if (publicForwarded) return publicForwarded;
  if (forwarded.length > 0) return forwarded.at(-1)!;

  return (
    normalizeIpCandidate(requestHeaders.get("x-real-ip") ?? "") ?? "unknown"
  );
}
