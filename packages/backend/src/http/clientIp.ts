/**
 * @description: Resolves the effective client IP for backend abuse controls.
 * @footnote-scope: utility
 * @footnote-module: ClientIpResolution
 * @footnote-risk: high - Incorrect proxy trust can bypass rate limits or misattribute CAPTCHA checks.
 * @footnote-ethics: high - Client identity is used for fair abuse controls and must not trust spoofed headers.
 */
import net from 'node:net';
import type { IncomingMessage } from 'node:http';

/**
 * Cloudflare's published edge ranges, copied from the definitive list at
 * https://www.cloudflare.com/ips/.
 *
 * Update this list when Cloudflare changes that page. Do not replace it with a
 * per-request network lookup or hostname/reverse-DNS check.
 */
export const CLOUDFLARE_EDGE_CIDRS = [
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '108.162.192.0/18',
    '131.0.72.0/22',
    '141.101.64.0/18',
    '162.158.0.0/15',
    '172.64.0.0/13',
    '173.245.48.0/20',
    '188.114.96.0/20',
    '190.93.240.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '2400:cb00::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
] as const;

type IpVersion = 4 | 6;

type ParsedIp = {
    version: IpVersion;
    bytes: number[];
    normalized: string;
};

export type ClientIpSource =
    'cloudflare' | 'fly-client-ip' | 'socket' | 'unknown';

export type ClientIpResolution = {
    clientIp: string;
    source: ClientIpSource;
};

const parseIpv4Bytes = (value: string): number[] | null => {
    const parts = value.split('.');
    if (parts.length !== 4) {
        return null;
    }

    const bytes = parts.map((part) => Number(part));
    if (
        bytes.some(
            (byte, index) =>
                !/^\d{1,3}$/.test(parts[index] ?? '') ||
                !Number.isInteger(byte) ||
                byte < 0 ||
                byte > 255
        )
    ) {
        return null;
    }

    return bytes;
};

const parseIpv6Bytes = (value: string): number[] | null => {
    let expandedValue = value;
    const embeddedIpv4Index = value.lastIndexOf(':');
    if (value.includes('.') && embeddedIpv4Index >= 0) {
        const ipv4 = parseIpv4Bytes(value.slice(embeddedIpv4Index + 1));
        if (!ipv4) {
            return null;
        }

        const ipv4Groups = [
            ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0),
            ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0),
        ];
        expandedValue = `${value.slice(0, embeddedIpv4Index)}:${ipv4Groups
            .map((group) => group.toString(16))
            .join(':')}`;
    }

    const doubleColonIndex = expandedValue.indexOf('::');
    if (
        doubleColonIndex !== -1 &&
        doubleColonIndex !== expandedValue.lastIndexOf('::')
    ) {
        return null;
    }

    const parseGroups = (groupsValue: string): number[] => {
        if (!groupsValue) {
            return [];
        }

        const groups = groupsValue.split(':');
        if (
            groups.some(
                (group) =>
                    !/^[0-9a-f]{1,4}$/i.test(group) ||
                    Number.parseInt(group, 16) > 0xffff
            )
        ) {
            return [];
        }

        return groups.map((group) => Number.parseInt(group, 16));
    };

    let groups: number[];
    if (doubleColonIndex >= 0) {
        const leftGroups = parseGroups(
            expandedValue.slice(0, doubleColonIndex)
        );
        const rightGroups = parseGroups(
            expandedValue.slice(doubleColonIndex + 2)
        );
        const omittedGroupCount = 8 - leftGroups.length - rightGroups.length;
        if (
            omittedGroupCount < 1 ||
            leftGroups.length + rightGroups.length >= 8
        ) {
            return null;
        }
        groups = [
            ...leftGroups,
            ...Array.from({ length: omittedGroupCount }, () => 0),
            ...rightGroups,
        ];
    } else {
        groups = parseGroups(expandedValue);
        if (groups.length !== 8) {
            return null;
        }
    }

    if (groups.length !== 8) {
        return null;
    }

    return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
};

const bytesToIpv4 = (bytes: number[]): string => bytes.join('.');

const bytesToIpv6 = (bytes: number[]): string => {
    const groups = Array.from(
        { length: 8 },
        (_, index) =>
            (bytes[index * 2] ?? 0) * 256 + (bytes[index * 2 + 1] ?? 0)
    );

    let bestStart = -1;
    let bestLength = 1;
    for (let index = 0; index < groups.length;) {
        if (groups[index] !== 0) {
            index += 1;
            continue;
        }
        const start = index;
        while (index < groups.length && groups[index] === 0) {
            index += 1;
        }
        const length = index - start;
        if (length > bestLength) {
            bestStart = start;
            bestLength = length;
        }
    }

    const parts: string[] = [];
    for (let index = 0; index < groups.length; index += 1) {
        if (index === bestStart) {
            parts.push('');
            index += bestLength - 1;
            if (index === groups.length - 1) {
                parts.push('');
            }
            continue;
        }
        parts.push((groups[index] ?? 0).toString(16));
    }

    const normalized = parts.join(':');
    return normalized.startsWith(':') ? `:${normalized}` : normalized;
};

const parseIp = (value: string | undefined): ParsedIp | null => {
    if (!value) {
        return null;
    }

    const trimmedValue = value.trim();
    if (
        !trimmedValue ||
        trimmedValue.includes(',') ||
        net.isIP(trimmedValue) === 0
    ) {
        return null;
    }

    const version = net.isIP(trimmedValue) as IpVersion;
    const bytes =
        version === 4
            ? parseIpv4Bytes(trimmedValue)
            : parseIpv6Bytes(trimmedValue);
    if (!bytes) {
        return null;
    }

    const isIpv4Mapped =
        version === 6 &&
        bytes.slice(0, 10).every((byte) => byte === 0) &&
        bytes[10] === 0xff &&
        bytes[11] === 0xff;
    if (isIpv4Mapped) {
        const ipv4Bytes = bytes.slice(12);
        return {
            version: 4,
            bytes: ipv4Bytes,
            normalized: bytesToIpv4(ipv4Bytes),
        };
    }

    return {
        version,
        bytes,
        normalized: version === 4 ? bytesToIpv4(bytes) : bytesToIpv6(bytes),
    };
};

const readSingleHeader = (
    value: string | string[] | undefined
): string | undefined => {
    if (Array.isArray(value)) {
        return value.length === 1 ? value[0] : undefined;
    }
    return value;
};

const ipMatchesCidr = (ip: ParsedIp, cidr: string): boolean => {
    const [networkValue, prefixValue] = cidr.split('/');
    const network = parseIp(networkValue);
    const prefixLength = Number(prefixValue);
    if (
        !network ||
        network.version !== ip.version ||
        !Number.isInteger(prefixLength) ||
        prefixLength < 0 ||
        prefixLength > ip.bytes.length * 8
    ) {
        return false;
    }

    const fullBytes = Math.floor(prefixLength / 8);
    const remainingBits = prefixLength % 8;
    for (let index = 0; index < fullBytes; index += 1) {
        if (ip.bytes[index] !== network.bytes[index]) {
            return false;
        }
    }

    if (remainingBits === 0) {
        return true;
    }

    const mask = (0xff << (8 - remainingBits)) & 0xff;
    return (
        ((ip.bytes[fullBytes] ?? 0) & mask) ===
        ((network.bytes[fullBytes] ?? 0) & mask)
    );
};

export const isCloudflareEdgeIp = (value: string | undefined): boolean => {
    const ip = parseIp(value);
    return Boolean(
        ip && CLOUDFLARE_EDGE_CIDRS.some((cidr) => ipMatchesCidr(ip, cidr))
    );
};

const resolveHeaderIp = (
    value: string | string[] | undefined
): ParsedIp | null => parseIp(readSingleHeader(value));

/**
 * Resolves the caller address used by rate limiting and Turnstile.
 *
 * WEB_TRUST_PROXY only enables the authenticated Cloudflare path. It never
 * means "trust X-Forwarded-For". Direct traffic uses Fly-Client-IP when Fly
 * supplied it, and all forwarded headers are ignored unless Fly-Client-IP is
 * itself within a checked-in Cloudflare edge range.
 */
export const resolveClientIp = (
    req: IncomingMessage,
    trustProxy: boolean
): ClientIpResolution => {
    const flyClientIp = resolveHeaderIp(req.headers['fly-client-ip']);
    const socketIp = parseIp(req.socket.remoteAddress ?? undefined);
    const directResolution: ClientIpResolution = flyClientIp
        ? { clientIp: flyClientIp.normalized, source: 'fly-client-ip' }
        : socketIp
          ? { clientIp: socketIp.normalized, source: 'socket' }
          : { clientIp: 'unknown', source: 'unknown' };

    if (
        !trustProxy ||
        !flyClientIp ||
        !isCloudflareEdgeIp(flyClientIp.normalized)
    ) {
        return directResolution;
    }

    const cloudflareClientIp = resolveHeaderIp(req.headers['cf-connecting-ip']);
    return cloudflareClientIp
        ? { clientIp: cloudflareClientIp.normalized, source: 'cloudflare' }
        : directResolution;
};
