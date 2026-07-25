import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

// These tests exist because the local-account-registry removal left App.jsx
// calling helpers that no longer existed (loadAccounts/loadSession). The mount
// effect threw a ReferenceError before it could route, so the app sat on
// "Loading your vault..." forever — in dev *and* in the packaged build — while
// the suite stayed green, because nothing rendered App.jsx.
function memoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe("App boot", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok:true, json:async()=>({}) }));
    vi.stubGlobal("localStorage", memoryStorage());
    delete window.collegeCounselorDesktop;
    delete window.__CC_SESSION_TOKEN__;
    delete window.__CC_CSRF_TOKEN__;
    window.history.replaceState(null, "", "/index.html");
  });

  afterEach(() => {
    cleanup();
    delete window.collegeCounselorDesktop;
    delete window.__CC_SESSION_TOKEN__;
    delete window.__CC_CSRF_TOKEN__;
    window.history.replaceState(null, "", "/index.html");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("routes to the login screen on mount instead of hanging on the loading state", async () => {
    render(<App />);

    expect(await screen.findByText("Welcome back")).toBeVisible();
    expect(screen.queryByText("Loading your vault...")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Device administrator" })).not.toBeInTheDocument();
  });

  it("does not enumerate accounts on the device", async () => {
    // A shared machine must not disclose who has an account, and no plaintext
    // registry backs this screen any more.
    window.localStorage.setItem(
      "cc_accounts_registry",
      JSON.stringify({ "student@school.edu": { name:"Real Student", grade:"Junior" } }),
    );

    render(<App />);
    await screen.findByText("Welcome back");

    expect(screen.queryByText("Accounts on this device")).not.toBeInTheDocument();
    expect(screen.queryByText(/Real Student/)).not.toBeInTheDocument();
    // The legacy registry is purged on mount rather than read.
    expect(window.localStorage.getItem("cc_accounts_registry")).toBeNull();
  });

  it("waits for runtime policy before exposing an account route", async () => {
    let resolveRuntimeConfig;
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (url === "/api/runtime-config") {
        return new Promise((resolve) => { resolveRuntimeConfig = resolve; });
      }
      return Promise.resolve(jsonResponse({}, 401));
    }));

    render(<App />);
    expect(screen.getByText("Preparing secure sign-in...")).toBeVisible();
    expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();

    await act(async () => {
      resolveRuntimeConfig(jsonResponse({ deployment: "saas", invitationRequired: true }));
    });
    expect(await screen.findByText("Welcome back")).toBeVisible();
  });

  it("captures a student invitation, scrubs the URL, and presents acknowledgements without self-consent language", async () => {
    window.history.replaceState(null, "", "/index.html?invite=student-secret&campaign=summer#onboarding");
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/runtime-config") {
        expect(window.location.search).toBe("");
        return jsonResponse({ deployment: "saas", invitationRequired: true });
      }
      if (url === "/api/students/session") return jsonResponse({}, 401);
      return jsonResponse({});
    }));
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "New student? Create account" }));

    expect(screen.getByLabelText("Organization invitation token")).toHaveValue("student-secret");
    expect(window.location.pathname).toBe("/index.html");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#onboarding");
    expect(screen.getByText("Required acknowledgements")).toBeVisible();
    expect(screen.getByText(/secure HttpOnly session/i)).toBeVisible();
    expect(screen.getByText(/passwords can be reset through the organization portal/i)).toBeVisible();
    expect(screen.getByLabelText(/I cannot grant required guardian consent for myself/i)).toBeVisible();
    expect(screen.getByLabelText(/My acknowledgement does not replace guardian consent/i)).toBeVisible();
    expect(screen.queryByText(/or I have parental\/guardian consent to use this tool/i)).not.toBeInTheDocument();
  });

  it("prompts for an organization after a multi-membership response and forwards the selected slug", async () => {
    const authBodies = [];
    let expireSession;
    const nativeSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
      if (delay === 15 * 60 * 1000) {
        expireSession = callback;
        return 424242;
      }
      return nativeSetTimeout(callback, delay, ...args);
    });
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/runtime-config") return jsonResponse({ deployment: "saas" });
      if (url === "/api/students/session") return jsonResponse({}, 401);
      if (url === "/api/students/auth") {
        const body = JSON.parse(options.body);
        authBodies.push(body);
        if (!body.organizationSlug) {
          return jsonResponse({ error: "Select an organization to continue.", code: "organization_required" }, 409);
        }
        return jsonResponse({
          authenticated: true,
          sessionMode: "cookie",
          csrfToken: "csrf-selected-org",
          student: { id: "student-1", name: "Alex Student", grade: 11 },
          organization: { slug: "northstar", name: "Northstar Academy" },
          membershipStatus: "active",
          profileComplete: false,
        });
      }
      if (url === "/api/students/logout") return jsonResponse({ loggedOut: true });
      if (url === "/api/students/profile") return jsonResponse({ profile: {}, activities: [], goals: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("link", { name: "Recover account" })).toHaveAttribute("href", "/organization.html?recovery=1");
    await user.type(await screen.findByLabelText("Email"), "alex@example.org");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("belongs to more than one organization");
    const organizationInput = screen.getByLabelText("Organization identifier (required)");
    expect(organizationInput).toBeRequired();
    expect(screen.getByText(/Required because this email has student access in multiple organizations/i)).toBeVisible();

    await user.type(organizationInput, " NorthStar ");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(authBodies).toHaveLength(2));
    expect(authBodies[0]).toEqual({ email: "alex@example.org", password: "correct horse battery" });
    expect(authBodies[1]).toEqual({
      email: "alex@example.org",
      password: "correct horse battery",
      organizationSlug: "northstar",
    });
    await waitFor(() => expect(expireSession).toBeTypeOf("function"));
    await act(async () => { expireSession(); });

    expect(await screen.findByRole("alert")).toHaveTextContent("Session expired due to inactivity");
    expect(await screen.findByLabelText("Password")).toHaveValue("");
    const logoutCall = fetchMock.mock.calls.find(([url]) => url === "/api/students/logout");
    expect(logoutCall[1].keepalive).toBe(true);
    expect(logoutCall[1].headers["X-CSRF-Token"]).toBe("csrf-selected-org");
    expect(logoutCall[1].headers).not.toHaveProperty("Authorization");
    expect(window.__CC_SESSION_TOKEN__).toBeNull();
    expect(window.__CC_CSRF_TOKEN__).toBe("");
  });

  it("restores a guardian-pending cookie session and sends CSRF without exposing the cookie sentinel on logout", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/runtime-config") return jsonResponse({ deployment: "saas", organizationPortalPath: "/organization.html" });
      if (url === "/api/students/session") {
        return jsonResponse({
          authenticated: true,
          sessionMode: "cookie",
          csrfToken: "csrf-memory-only",
          student: { id: "student-1", name: "Alex Student", email: "alex@example.org", grade: 11 },
          organization: { slug: "northstar", name: "Northstar Academy" },
          membershipStatus: "pending_guardian",
        });
      }
      if (url === "/api/students/logout") return jsonResponse({ loggedOut: true });
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Waiting for guardian approval" })).toBeVisible();
    expect(screen.getByText(/Northstar Academy/)).toBeVisible();
    expect(screen.getByRole("link", { name: "the organization portal" })).toHaveAttribute("href", "/organization.html");
    expect(window.__CC_SESSION_TOKEN__).toBe("__cc_http_only_cookie__");
    expect(window.__CC_CSRF_TOKEN__).toBe("csrf-memory-only");

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Welcome back")).toBeVisible();
    const logoutCall = fetchMock.mock.calls.find(([url]) => url === "/api/students/logout");
    expect(logoutCall[1].credentials).toBe("same-origin");
    expect(logoutCall[1].headers["X-CSRF-Token"]).toBe("csrf-memory-only");
    expect(logoutCall[1].headers).not.toHaveProperty("Authorization");
    expect(window.__CC_SESSION_TOKEN__).toBeNull();
    expect(window.__CC_CSRF_TOKEN__).toBe("");
  });

  it("loads private-web registration settings and forwards the access code", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === "/api/runtime-config") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ deployment: "web", registrationAccessCodeRequired: true }),
        };
      }
      if (url === "/api/students/register") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ token: "session-token", studentId: "student-1", recoveryCode: "recover-once" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "New student? Create account" }));

    expect(await screen.findByLabelText("Access code")).toBeVisible();
    expect(screen.getByText(/private encrypted storage/i)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Device administrator" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("First name"), "Alex");
    await user.type(screen.getByLabelText("Last name"), "Kim");
    await user.type(screen.getByLabelText("School or organizational email"), "alex@school.edu");
    await user.click(screen.getByRole("button", { name: "Junior" }));
    await user.type(screen.getByLabelText(/Passphrase \(encrypts your vault/i), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm passphrase"), "correct horse battery staple");
    await user.type(screen.getByLabelText("Access code"), "private-invite");
    await user.click(screen.getByLabelText(/I confirm I am a high school student/i));
    await user.click(screen.getByLabelText(/I understand my questions are processed by an AI system/i));
    await user.click(screen.getByLabelText(/I consent to my academic data being processed/i));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      const registrationCall = fetchMock.mock.calls.find(([url]) => url === "/api/students/register");
      expect(registrationCall).toBeDefined();
      expect(JSON.parse(registrationCall[1].body)).toMatchObject({
        email: "alex@school.edu",
        registrationAccessCode: "private-invite",
      });
    });
  });
});
