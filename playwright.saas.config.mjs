import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const appPort = Number.parseInt(process.env.SAAS_BROWSER_PORT || "3211", 10);
const baseURL = `http://127.0.0.1:${appPort}`;
const publicOrigin = "https://saas-browser.local.test";
const secret = () => crypto.randomBytes(32).toString("hex");
const dataDir = process.env.SAAS_BROWSER_DATA_DIR
  || path.join(os.tmpdir(), `college-counselor-saas-browser-${process.pid}-${crypto.randomUUID()}`);

const browserTargets = [
  { name: "chromium", browserName: "chromium" },
  { name: "google-chrome", browserName: "chromium", channel: "chrome" },
  { name: "microsoft-edge", browserName: "chromium", channel: "msedge" },
  { name: "firefox", browserName: "firefox" },
  { name: "webkit", browserName: "webkit" },
];

const viewports = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "mobile-390", viewport: { width: 390, height: 844 } },
];

const projects = browserTargets.flatMap((browserTarget, browserIndex) => (
  viewports.map((viewportTarget, viewportIndex) => ({
    name: `${browserTarget.name}-${viewportTarget.name}`,
    use: {
      browserName: browserTarget.browserName,
      ...(browserTarget.channel ? { channel: browserTarget.channel } : {}),
      viewport: viewportTarget.viewport,
      // CI connects directly to the trusted-proxy test server, so give each
      // independent browser/viewport client a distinct TEST-NET address. This
      // keeps the production per-client limiter enabled while avoiding the
      // artificial single-IP burst created by a local browser matrix.
      extraHTTPHeaders: {
        "X-Forwarded-For": `198.51.100.${1 + (browserIndex * viewports.length) + viewportIndex}`,
      },
    },
  }))
));

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "saas-entry.spec.mjs",
  outputDir: "test-results/saas-browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : "list",
  use: {
    baseURL,
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start:saas",
    url: `${baseURL}/api/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      WEB_DEPLOYMENT: "1",
      SAAS_DEPLOYMENT: "1",
      HOST: "127.0.0.1",
      PORT: String(appPort),
      SIM_PORT: String(appPort + 1),
      DATA_DIR: dataDir,
      SIM_DATA_DIR: path.join(dataDir, "simulations"),
      TRUST_PROXY: "1",
      PUBLIC_DOMAIN: "saas-browser.local.test",
      PUBLIC_ORIGIN: publicOrigin,
      INVITE_BASE_URL: publicOrigin,
      ENCRYPTION_KEY: secret(),
      SIM_INTERNAL_TOKEN: secret(),
      STUDENT_STORAGE_SALT: secret(),
      SAAS_EMAIL_PEPPER: secret(),
      SAAS_PROVISIONING_TOKEN: secret(),
      RESEND_API_KEY: "re_browser_test_not_used",
      EMAIL_FROM: "Browser Test <browser@saas-browser.local.test>",
      OPENROUTER_API_KEY: "",
      SCORECARD_API_KEY: "",
      RETENTION_MODE: "institutional",
      SAAS_GUARDIAN_CONSENT_REQUIRED: "1",
      SAAS_POLICY_VERSION: "2026.1",
      SAAS_PASSWORD_RESET_TTL_MINUTES: "30",
      CDS_DAILY_REFRESH: "0",
      AUTO_REFRESH_CDS: "0",
      ENABLE_DOMAIN_MONITOR: "0",
    },
  },
  projects,
});
