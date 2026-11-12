import { hmacHex, type KeyInput } from './key.ts';

const MAX_ADDRESS_LENGTH = 64;

function ipv4Octets(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

// The eight 16-bit groups of an IPv6 address, or null when it does not parse.
// A dotted IPv4 tail counts as two groups (RFC 4291). Zone ids are rejected.
function ipv6Groups(value: string): number[] | null {
  if (!value.includes(':') || value.includes('%')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string, last: boolean): number[] | null => {
    if (side === '') return [];
    const parts = side.split(':');
    const groups: number[] = [];
    for (const [index, part] of parts.entries()) {
      const octets = ipv4Octets(part);
      if (octets !== null) {
        // An embedded IPv4 part is only valid at the very end of the address.
        if (!last || index !== parts.length - 1) return null;
        groups.push((octets[0] ?? 0) * 256 + (octets[1] ?? 0));
        groups.push((octets[2] ?? 0) * 256 + (octets[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      groups.push(parseInt(part, 16));
    }
    return groups;
  };
  const head = parseSide(halves[0] ?? '', halves.length === 1);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseSide(halves[1] ?? '', true);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  // "::" must stand for at least one group.
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * The network an address belongs to, as text: the /24 of an IPv4 address
 * (`203.0.113.0`) or the /48 of an IPv6 address (`2001:db8:12::/48`).
 * An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is treated as IPv4.
 * Returns `null` for anything that is not an address.
 */
export function networkOf(ip: string): string | null {
  if (typeof ip !== 'string' || ip.length > MAX_ADDRESS_LENGTH) return null;
  const address = ip.trim();
  const octets = ipv4Octets(address);
  if (octets !== null) return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  const groups = ipv6Groups(address);
  if (groups === null) return null;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return `${high >> 8}.${high & 0xff}.${low >> 8}.0`;
  }
  return `${groups
    .slice(0, 3)
    .map((group) => group.toString(16))
    .join(':')}::/48`;
}

/**
 * True for addresses that identify a network on the public internet. Loopback,
 * unspecified, link-local, private and carrier-internal addresses are what a
 * server sees when it reads its own proxy's address instead of the client's;
 * every visitor would then appear to share one network.
 */
export function isPublicAddress(ip: string): boolean {
  const network = networkOf(ip);
  if (network === null) return false;
  if (!network.includes(':')) {
    const [a = 0, b = 0] = network.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const first = parseInt(network.split(':')[0] ?? '0', 16);
  // 0::/16 holds the unspecified and loopback addresses, fc00::/7 is private, fe80::/10 link-local.
  return !(first === 0 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80);
}

/**
 * A keyed digest of the address's network (IPv4 /24, IPv6 /48): lowercase hex
 * HMAC-SHA256 of `net:<network>`. Two addresses on the same network give the
 * same digest; the address itself is not recoverable without the key.
 * Resolves to `null` when `ip` is not a valid address.
 */
export async function networkKey(key: KeyInput, ip: string): Promise<string | null> {
  const network = networkOf(ip);
  return network === null ? null : hmacHex(key, `net:${network}`);
}
