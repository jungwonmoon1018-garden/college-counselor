import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  assertPublicHttpUrl,
  fetchPublicResource,
  isBlockedAddress,
  requestPinned,
} from "../safe-http.js";

test("special-use IPv4 and IPv6 addresses are blocked", () => {
  for (const address of [
    "0.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.1",
  ]) {
    assert.equal(isBlockedAddress(address, 4), true, address);
  }
  assert.equal(isBlockedAddress("8.8.8.8", 4), false);

  for (const address of [
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fe90::1",
    "febf::1",
    "fc00::1",
    "2001::1",
    "2001:db8::1",
    "2002::1",
    "ff00::1",
  ]) {
    assert.equal(isBlockedAddress(address, 6), true, address);
  }
  assert.equal(isBlockedAddress("2001:4860:4860::8888", 6), false);
  assert.equal(isBlockedAddress("2606:4700:4700::1111", 6), false);
});

test("URL validation rejects credentials, nonstandard ports, and mixed DNS answers", async () => {
  await assert.rejects(
    assertPublicHttpUrl("https://user:secret@example.com/file.pdf"),
    (error) => error.code === "credentials_forbidden",
  );
  await assert.rejects(
    assertPublicHttpUrl("https://example.com:8443/file.pdf"),
    (error) => error.code === "port_forbidden",
  );
  await assert.rejects(
    assertPublicHttpUrl("https://mixed.example/file.pdf", {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    (error) => error.code === "address_forbidden",
  );
});

test("redirects are revalidated and each request receives the vetted pinned address", async () => {
  const addresses = {
    "first.example": "93.184.216.34",
    "second.example": "151.101.1.69",
  };
  const requested = [];
  const response = await fetchPublicResource("https://first.example/start", {
    lookupImpl: async (hostname) => [{ address: addresses[hostname], family: 4 }],
    requestImpl: async (target) => {
      requested.push({ hostname: target.url.hostname, address: target.address });
      if (target.url.hostname === "first.example") {
        return {
          status: 302,
          headers: { location: "https://second.example/document.pdf" },
          body: Buffer.alloc(0),
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: Buffer.from("%PDF"),
      };
    },
  });

  assert.deepEqual(requested, [
    { hostname: "first.example", address: "93.184.216.34" },
    { hostname: "second.example", address: "151.101.1.69" },
  ]);
  assert.equal(await response.text(), "%PDF");
});

test("a redirect to a private address is rejected before a second request", async () => {
  let requests = 0;
  await assert.rejects(
    fetchPublicResource("https://first.example/start", {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: async () => {
        requests += 1;
        return {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
          body: Buffer.alloc(0),
        };
      },
    }),
    (error) => error.code === "address_forbidden",
  );
  assert.equal(requests, 1);
});

test("response byte limit is enforced for injected and real transports", async () => {
  await assert.rejects(
    fetchPublicResource("https://public.example/file", {
      maxBytes: 4,
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: async () => ({
        status: 200,
        headers: {},
        body: Buffer.from("12345"),
      }),
    }),
    (error) => error.code === "response_too_large",
  );
});

test("absolute deadline stops a trickle response", { timeout: 3_000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    const interval = setInterval(() => response.write("x"), 20);
    interval.unref?.();
    response.on("close", () => clearInterval(interval));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    const target = {
      url: new URL(`http://trickle.example:${port}/stream`),
      address: "127.0.0.1",
      family: 4,
    };
    await assert.rejects(
      requestPinned(target, {
        headers: {},
        timeoutMs: 120,
        maxBytes: 1_024,
      }),
      (error) => error.code === "fetch_timeout",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
