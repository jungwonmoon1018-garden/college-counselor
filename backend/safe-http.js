import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const SAFE_HTTP_DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  maxBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
});

export class SafeHttpError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "SafeHttpError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function parseIPv4(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function ipv4InCidr(value, base, prefix) {
  if (prefix === 0) return true;
  const divisor = 2 ** (32 - prefix);
  return Math.floor(value / divisor) === Math.floor(base / divisor);
}

const BLOCKED_IPV4_CIDRS = Object.freeze([
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, prefix]) => [parseIPv4(base), prefix]));

function parseIPv6(address) {
  let source = String(address || "").toLowerCase();
  if (source.includes("%")) return null;
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const ipv4 = parseIPv4(source.slice(lastColon + 1));
    if (ipv4 == null) return null;
    source = source.slice(0, lastColon)
      + ":" + ((ipv4 >>> 16) & 0xffff).toString(16)
      + ":" + (ipv4 & 0xffff).toString(16);
  }
  if ((source.match(/::/g) || []).length > 1) return null;
  const [leftRaw, rightRaw = ""] = source.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!source.includes("::") && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function ipv6InCidr(value, base, prefix) {
  if (prefix === 0) return true;
  return (value >> BigInt(128 - prefix)) === (base >> BigInt(128 - prefix));
}

const BLOCKED_IPV6_CIDRS = Object.freeze([
  ["2001:db8::", 32],
  ["2002::", 16],
].map(([base, prefix]) => [parseIPv6(base), prefix]));

export function isBlockedAddress(address, family = net.isIP(address)) {
  const normalizedFamily = family === "IPv4" ? 4 : family === "IPv6" ? 6 : Number(family);
  if (normalizedFamily === 4) {
    const value = parseIPv4(address);
    return value == null || BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
  }
  if (normalizedFamily !== 6) return true;
  const value = parseIPv6(address);
  if (value == null) return true;

  // IPv4-mapped IPv6 must inherit the embedded IPv4 classification.
  if ((value >> 32n) === 0xffffn) {
    const embedded = Number(value & 0xffffffffn);
    const ipv4 = [
      (embedded >>> 24) & 255,
      (embedded >>> 16) & 255,
      (embedded >>> 8) & 255,
      embedded & 255,
    ].join(".");
    return isBlockedAddress(ipv4, 4);
  }

  // Current globally-routable unicast space is 2000::/3. This excludes
  // unspecified, loopback, ULA, link-local, site-local and multicast ranges.
  const globalUnicastBase = parseIPv6("2000::");
  if (!ipv6InCidr(value, globalUnicastBase, 3)) return true;
  return BLOCKED_IPV6_CIDRS.some(([base, prefix]) => ipv6InCidr(value, base, prefix));
}

function normalizeAddresses(result) {
  const values = Array.isArray(result) ? result : [result];
  return values.map((item) => {
    if (typeof item === "string") return { address: item, family: net.isIP(item) };
    return {
      address: item?.address,
      family: item?.family === "IPv4" ? 4 : item?.family === "IPv6" ? 6 : Number(item?.family),
    };
  });
}

function timeoutError() {
  return new SafeHttpError("fetch_timeout", "Public HTTP request timed out.");
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function assertPublicHttpUrl(rawUrl, {
  lookupImpl = dns.lookup,
  timeoutMs = SAFE_HTTP_DEFAULTS.timeoutMs,
} = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeHttpError("url_malformed", "Refusing to fetch a malformed URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeHttpError("scheme_forbidden", "Only http(s) URLs may be fetched.");
  }
  if (url.username || url.password) {
    throw new SafeHttpError("credentials_forbidden", "URL credentials are not allowed.");
  }
  if (url.href.length > 2_048) {
    throw new SafeHttpError("url_too_long", "URL is too long.");
  }
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) {
    throw new SafeHttpError("port_forbidden", "Only standard HTTP and HTTPS ports are allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    let result;
    try {
      result = await withTimeout(
        Promise.resolve(lookupImpl(hostname, { all: true, verbatim: true })),
        Math.max(1, Number(timeoutMs) || SAFE_HTTP_DEFAULTS.timeoutMs),
      );
    } catch (cause) {
      if (cause?.code === "fetch_timeout") throw cause;
      throw new SafeHttpError("dns_failed", "Refusing to fetch an unresolvable host.", cause);
    }
    addresses = normalizeAddresses(result);
  }

  if (
    addresses.length === 0
    || addresses.length > 16
    || addresses.some(({ address, family }) => !address || isBlockedAddress(address, family))
  ) {
    throw new SafeHttpError("address_forbidden", "Refusing to fetch a non-public address.");
  }

  // One vetted address is selected and passed into a custom lookup callback;
  // the socket never performs a second, attacker-influenced DNS lookup.
  return { url, address: addresses[0].address, family: addresses[0].family };
}

function headerValue(headers, name) {
  const value = headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value == null ? null : String(value);
}

function requestPinned(target, { headers, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const client = target.url.protocol === "https:" ? https : http;
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = client.request(target.url, {
      method: "GET",
      agent: false,
      headers: {
        "accept-encoding": "identity",
        ...headers,
      },
      servername: target.url.hostname.replace(/^\[|\]$/g, ""),
      lookup(_hostname, options, callback) {
        if (options?.all) {
          callback(null, [{ address: target.address, family: target.family }]);
        } else {
          callback(null, target.address, target.family);
        }
      },
    }, (response) => {
      const declaredLength = Number(headerValue(response.headers, "content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy();
        finishReject(new SafeHttpError("response_too_large", "Public HTTP response exceeds the byte limit."));
        return;
      }
      const encoding = String(headerValue(response.headers, "content-encoding") || "identity").toLowerCase();
      if (encoding !== "identity") {
        response.destroy();
        finishReject(new SafeHttpError("content_encoding_forbidden", "Compressed public HTTP responses are not accepted."));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          finishReject(new SafeHttpError("response_too_large", "Public HTTP response exceeds the byte limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: Number(response.statusCode) || 0,
          headers: response.headers,
          body: Buffer.concat(chunks, total),
        });
      });
      response.on("error", finishReject);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(timeoutError());
    });
    request.on("error", (cause) => {
      if (cause?.code === "fetch_timeout") return finishReject(cause);
      finishReject(new SafeHttpError("request_failed", "Public HTTP request failed.", cause));
    });
    request.end();
  });
}

function makeResponse({ status, headers, body }, url) {
  const safeBody = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        return headerValue(headers, name);
      },
    },
    async text() {
      return safeBody.toString("utf8");
    },
    async arrayBuffer() {
      return safeBody.buffer.slice(safeBody.byteOffset, safeBody.byteOffset + safeBody.byteLength);
    },
  };
}

export async function fetchPublicResource(rawUrl, {
  headers = {},
  timeoutMs = SAFE_HTTP_DEFAULTS.timeoutMs,
  maxBytes = SAFE_HTTP_DEFAULTS.maxBytes,
  maxRedirects = SAFE_HTTP_DEFAULTS.maxRedirects,
  lookupImpl = dns.lookup,
  requestImpl = requestPinned,
} = {}) {
  const startedAt = Date.now();
  let current = String(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw timeoutError();
    const target = await assertPublicHttpUrl(current, {
      lookupImpl,
      timeoutMs: remainingMs,
    });
    const rawResponse = await requestImpl(target, {
      headers,
      timeoutMs: remainingMs,
      maxBytes,
    });
    const body = Buffer.isBuffer(rawResponse?.body)
      ? rawResponse.body
      : Buffer.from(rawResponse?.body || "");
    if (body.length > maxBytes) {
      throw new SafeHttpError("response_too_large", "Public HTTP response exceeds the byte limit.");
    }
    const status = Number(rawResponse?.status) || 0;
    const location = headerValue(rawResponse?.headers, "location");
    if (status >= 300 && status < 400 && location) {
      if (hop === maxRedirects) {
        throw new SafeHttpError("too_many_redirects", "Public HTTP request exceeded the redirect limit.");
      }
      current = new URL(location, target.url).toString();
      continue;
    }
    return makeResponse({ ...rawResponse, status, body }, target.url.toString());
  }
  throw new SafeHttpError("too_many_redirects", "Public HTTP request exceeded the redirect limit.");
}
