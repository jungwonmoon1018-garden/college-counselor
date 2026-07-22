import { expect, test } from "@playwright/test";

const entries = [
  {
    name: "student",
    sessionProbe: "/api/students/session",
    path: "/",
    root: "#root",
    heading: /Welcome back/i,
    title: /College Counselor/i,
  },
  {
    name: "student invitation",
    sessionProbe: "/api/students/session",
    path: "/?invite=playwright-student-invite-secret&campaign=browser#onboarding",
    root: "#root",
    heading: /Welcome back/i,
    title: /College Counselor/i,
    historySeed: "/",
    historySeedHeading: /Welcome back/i,
    credentialSecret: "playwright-student-invite-secret",
    sanitizedPathname: "/",
    sanitizedHash: "#onboarding",
  },
  {
    name: "organization",
    sessionProbe: "/api/organization/session",
    path: "/organization.html",
    root: "#organization-root",
    heading: /Organization sign in/i,
    title: /Organization Portal/i,
  },
  {
    name: "organization password reset",
    sessionProbe: "/api/organization/session",
    path: "/organization.html?reset=playwright-reset-secret&campaign=browser#finish",
    root: "#organization-root",
    heading: /Choose a new organization password/i,
    title: /Organization Portal/i,
    historySeed: "/organization.html",
    historySeedHeading: /Organization sign in/i,
    credentialSecret: "playwright-reset-secret",
    sanitizedPathname: "/organization.html",
    sanitizedHash: "#finish",
  },
];

for (const entry of entries) {
  test(`${entry.name} entry renders without browser errors`, async ({ page }) => {
    const sessionProbe = entry.sessionProbe;
    const consoleErrors = [];
    const browserErrors = [];
    let expectedProbeResponses = 0;

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push({ text: message.text(), url: message.location().url || "" });
      }
    });
    page.on("pageerror", (error) => {
      browserErrors.push(`page: ${error.stack || error.message}`);
    });
    page.on("requestfailed", (request) => {
      const failedUrl = new URL(request.url());
      if (failedUrl.pathname === sessionProbe && request.failure()?.errorText === "net::ERR_ABORTED") {
        return;
      }
      browserErrors.push(
        `request: ${request.method()} ${request.url()} (${request.failure()?.errorText || "failed"})`,
      );
    });
    page.on("response", (resourceResponse) => {
      if (resourceResponse.status() < 400) return;
      const resourceUrl = new URL(resourceResponse.url());
      if (resourceResponse.status() === 401 && resourceUrl.pathname === sessionProbe) {
        expectedProbeResponses += 1;
        return;
      }
      browserErrors.push(
        `response: ${resourceResponse.status()} ${resourceResponse.request().method()} ${resourceResponse.url()}`,
      );
    });

    if (entry.historySeed) {
      const seedResponse = await page.goto(entry.historySeed, { waitUntil: "domcontentloaded" });
      expect(seedResponse?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: entry.historySeedHeading })).toBeVisible();
    }

    const response = await page.goto(entry.path, { waitUntil: "domcontentloaded" });
    expect(response, `${entry.path} did not produce a main-document response.`).not.toBeNull();
    expect(response.status(), `${entry.path} did not return HTTP 200.`).toBe(200);
    const responseHeaders = response.headers();
    const contentSecurityPolicy = responseHeaders["content-security-policy"] || "";
    expect(
      contentSecurityPolicy,
      `${entry.path} is missing a default-src 'self' Content Security Policy.`,
    ).toMatch(/(?:^|;)\s*default-src\s+'self'(?:\s|;|$)/iu);
    expect(responseHeaders["x-content-type-options"]).toBe("nosniff");
    const frameOptions = responseHeaders["x-frame-options"] || "";
    const hasFrameAncestors = /(?:^|;)\s*frame-ancestors\s+(?:'none'|'self')(?:\s|;|$)/iu
      .test(contentSecurityPolicy);
    expect(
      /^(?:DENY|SAMEORIGIN)$/iu.test(frameOptions) || hasFrameAncestors,
      `${entry.path} is missing frame-embedding protection.`,
    ).toBe(true);
    await expect(page).toHaveTitle(entry.title);

    const root = page.locator(entry.root);
    await expect(root).toBeVisible();
    await expect(page.getByRole("heading", { name: entry.heading })).toBeVisible();
    await expect.poll(async () => (await root.innerText()).trim().length).toBeGreaterThan(20);
    // The student shell intentionally keeps background work alive. A bounded
    // post-render settle catches asynchronous boot errors without relying on
    // a network-idle state that the product does not promise.
    await page.waitForTimeout(500);

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(
      layout.documentWidth,
      `${entry.path} overflows horizontally at ${layout.viewportWidth}px.`,
    ).toBeLessThanOrEqual(layout.viewportWidth + 1);

    if (entry.credentialSecret) {
      const scrubbed = await page.evaluate(() => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        historyState: JSON.stringify(window.history.state),
        localStorage: JSON.stringify(window.localStorage),
        sessionStorage: JSON.stringify(window.sessionStorage),
        bodyText: document.body.innerText,
      }));
      expect(scrubbed.pathname).toBe(entry.sanitizedPathname);
      expect(scrubbed.search).toBe("");
      expect(scrubbed.hash).toBe(entry.sanitizedHash);
      expect(JSON.stringify(scrubbed)).not.toContain(entry.credentialSecret);
      expect(page.url()).not.toContain(entry.credentialSecret);

      await page.goBack({ waitUntil: "domcontentloaded" });
      expect(page.url()).not.toContain(entry.credentialSecret);
      await page.goForward({ waitUntil: "domcontentloaded" });
      expect(page.url()).not.toContain(entry.credentialSecret);
      await page.waitForTimeout(500);
    }

    // Browsers surface the signed-out session probe's intentional 401 as a
    // console error. Exempt only one matching browser-generated diagnostic per
    // observed probe response; all other HTTP, console, and page errors fail.
    let remainingExpectedProbeDiagnostics = expectedProbeResponses;
    for (const consoleError of consoleErrors) {
      let locationPath = "";
      try { locationPath = new URL(consoleError.url).pathname; } catch {}
      const describesUnauthorizedResource = /\b401\b|Unauthorized/iu.test(consoleError.text)
        && (locationPath === sessionProbe
          || (!locationPath && /^Failed to load resource:/iu.test(consoleError.text)));
      const isExpectedProbeDiagnostic = remainingExpectedProbeDiagnostics > 0
        && describesUnauthorizedResource;
      if (isExpectedProbeDiagnostic) {
        remainingExpectedProbeDiagnostics -= 1;
      } else {
        browserErrors.push(`console: ${consoleError.text}`);
      }
    }
    expect(browserErrors, browserErrors.join("\n")).toEqual([]);
  });
}
