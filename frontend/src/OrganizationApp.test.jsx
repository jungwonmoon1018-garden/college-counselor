import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrganizationApp from "./OrganizationApp.jsx";

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function requestBody(call) {
  return JSON.parse(call[1]?.body || "{}");
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key) => values.get(String(key)) ?? null),
    key: vi.fn((index) => [...values.keys()][index] ?? null),
    removeItem: vi.fn((key) => values.delete(String(key))),
    setItem: vi.fn((key, value) => values.set(String(key), String(value))),
  };
}

const adminSession = {
  authenticated: true,
  csrfToken: "csrf-admin-memory-only",
  member: {
    id: "member-owner",
    name: "Morgan Owner",
    email: "owner@northstar.org",
    role: "org_admin",
  },
  organization: {
    id: "org-northstar",
    slug: "northstar",
    displayName: "Northstar Academy",
  },
};

describe("OrganizationApp", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    window.history.replaceState(null, "", "/organization.html");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/organization.html");
  });

  it("inspects and accepts an invitation without persisting its secret or password", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/organization.html?invite=invite-secret-123");
    const localStorageSpy = vi.spyOn(window.localStorage, "setItem");
    const sessionStorageSpy = vi.spyOn(window.sessionStorage, "setItem");

    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/invitations/inspect?token=invite-secret-123") {
        return jsonResponse({
          valid: true,
          invitation: {
            id: "invite-1",
            email: "guardian@example.org",
            role: "guardian",
            targetStudentId: "student-42",
            expiresAt: "2030-01-01T00:00:00.000Z",
          },
          organization: { slug: "northstar", displayName: "Northstar Academy" },
        });
      }
      if (url === "/api/organization/invitations/accept") {
        expect(options.credentials).toBe("same-origin");
        expect(requestBody([url, options])).toEqual({
          token: "invite-secret-123",
          email: "guardian@example.org",
          name: "Grace Guardian",
          password: "correct horse battery",
        });
        return jsonResponse({
          authenticated: true,
          csrfToken: "csrf-guardian-secret",
          member: {
            id: "guardian-1",
            name: "Grace Guardian",
            email: "guardian@example.org",
            role: "guardian",
          },
          organization: { slug: "northstar", displayName: "Northstar Academy" },
        });
      }
      if (url === "/api/organization/guardian/students") {
        return jsonResponse({ students: [] });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    }));

    render(
      <React.StrictMode>
        <OrganizationApp />
      </React.StrictMode>,
    );
    expect(await screen.findByRole("heading", { name: "Join Northstar Academy" })).toBeVisible();
    expect(screen.getByLabelText("Invitation email")).toHaveValue("guardian@example.org");
    expect(window.location.search).toBe("");
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Grace Guardian" } });
    fireEvent.change(screen.getByLabelText("Password", { selector: "#invite-password" }), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "correct horse battery" } });
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(await screen.findByRole("heading", { name: "Linked students and consent" })).toBeVisible();
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.body).not.toHaveTextContent("invite-secret-123");
    expect(document.body).not.toHaveTextContent("csrf-guardian-secret");
    expect(document.body).not.toHaveTextContent("correct horse battery");
  });

  it("lets an admin list members and create an invitation without rendering student content", async () => {
    const user = userEvent.setup();
    let invitationReads = 0;
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/session") return jsonResponse(adminSession);
      if (url === "/api/organization/members") {
        return jsonResponse({
          members: [{
            id: "student-member",
            name: "Alex Student",
            email: "alex@example.org",
            role: "student",
            status: "active",
            profile: { gpa: "TOP-SECRET-GPA" },
            chat: "TOP-SECRET-CHAT",
            files: ["TOP-SECRET-FILE"],
          }],
        });
      }
      if (url === "/api/organization/invitations" && (options.method || "GET") === "GET") {
        invitationReads += 1;
        return jsonResponse({
          invitations: invitationReads === 1
            ? []
            : [{
                id: "invite-guardian",
                email: "parent@example.org",
                role: "guardian",
                status: "pending",
                targetStudentId: "student-42",
              }],
        });
      }
      if (url === "/api/organization/invitations" && options.method === "POST") {
        expect(options.credentials).toBe("same-origin");
        expect(options.headers["X-CSRF-Token"]).toBe("csrf-admin-memory-only");
        expect(requestBody([url, options])).toEqual({
          email: "parent@example.org",
          role: "guardian",
          targetStudentId: "student-42",
        });
        return jsonResponse({ created: true }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationApp />);
    expect(await screen.findByRole("heading", { name: "Members" })).toBeVisible();
    expect(await screen.findByText("Alex Student")).toBeVisible();
    expect(document.body).not.toHaveTextContent("TOP-SECRET-GPA");
    expect(document.body).not.toHaveTextContent("TOP-SECRET-CHAT");
    expect(document.body).not.toHaveTextContent("TOP-SECRET-FILE");
    expect(screen.getByText(/never exposes student profiles/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText("Invitee email"), { target: { value: "parent@example.org" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "guardian" } });
    fireEvent.change(screen.getByLabelText("Target student ID"), { target: { value: "student-42" } });
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("parent@example.org")).toBeVisible();
    expect(screen.getByText("Student ID: student-42")).toBeVisible();
  });

  it("lets a guardian grant a required policy-versioned consent", async () => {
    const user = userEvent.setup();
    const guardianSession = {
      authenticated: true,
      csrfToken: "csrf-guardian",
      member: {
        id: "guardian-1",
        name: "Taylor Guardian",
        email: "taylor@example.org",
        role: "guardian",
      },
      organization: { slug: "northstar", displayName: "Northstar Academy" },
    };
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/session") return jsonResponse(guardianSession);
      if (url === "/api/organization/guardian/students") {
        return jsonResponse({
          students: [{
            id: "student-42",
            name: "Alex Student",
            grade: "11",
            requiredConsents: [{
              type: "data_processing",
              label: "Data processing consent",
              policyVersion: "2026.1",
              granted: false,
              purpose: "Provide personalized college counseling and application support.",
              dataCategories: ["Student profile", "Counseling activity"],
              recipients: ["Northstar counselors", "Contracted cloud providers"],
              internationalTransfers: "Processing may occur in the United States with contractual safeguards.",
              retention: "Retained while enrolled, then deleted within 90 days.",
              rights: ["Access", "Export", "Correction", "Revoke consent", "Delete"],
              policyUrl: "https://policies.northstar.example/student-data",
              scope: {
                features: ["college-counseling"],
                dataCategories: ["student-profile", "counseling-activity"],
              },
            }],
            profile: "PRIVATE-STUDENT-PROFILE",
          }],
        });
      }
      if (url === "/api/organization/guardian/consent") {
        expect(options.method).toBe("POST");
        expect(options.credentials).toBe("same-origin");
        expect(options.headers["X-CSRF-Token"]).toBe("csrf-guardian");
        expect(requestBody([url, options])).toEqual({
          studentId: "student-42",
          consentType: "data_processing",
          policyVersion: "2026.1",
          granted: true,
          scope: {
            features: ["college-counseling"],
            dataCategories: ["student-profile", "counseling-activity"],
          },
        });
        return jsonResponse({ updated: true });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationApp />);
    expect(await screen.findByRole("heading", { name: "Linked students and consent" })).toBeVisible();
    expect(screen.getByText("Data processing consent")).toBeVisible();
    expect(screen.getByText("Provide personalized college counseling and application support.")).toBeVisible();
    expect(screen.getByText("Student profile")).toBeVisible();
    expect(screen.getByText("Counseling activity")).toBeVisible();
    expect(screen.getByText("Northstar counselors")).toBeVisible();
    expect(screen.getByText("Contracted cloud providers")).toBeVisible();
    expect(screen.getByText(/processing may occur in the United States/i)).toBeVisible();
    expect(screen.getByText(/deleted within 90 days/i)).toBeVisible();
    expect(screen.getByText("Access")).toBeVisible();
    expect(screen.getByText("Export")).toBeVisible();
    expect(screen.getByText("Correction")).toBeVisible();
    expect(screen.getByText("Revoke consent")).toBeVisible();
    expect(screen.getByText("Delete")).toBeVisible();
    expect(screen.getByText("2026.1", { selector: "dd" })).toBeVisible();
    expect(screen.getByRole("link", { name: /read the full policy/i })).toHaveAttribute(
      "href",
      "https://policies.northstar.example/student-data",
    );
    expect(document.body).not.toHaveTextContent("PRIVATE-STUDENT-PROFILE");
    await user.click(screen.getByRole("button", { name: "Grant consent" }));

    expect(await screen.findByText("Policy 2026.1 · Granted")).toBeVisible();
    expect(screen.getByRole("button", { name: "Revoke consent" })).toBeEnabled();
  });

  it("blocks a guardian grant when a material disclosure or scope is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/organization/session") {
        return jsonResponse({
          authenticated: true,
          csrfToken: "csrf-guardian",
          member: {
            id: "guardian-1",
            name: "Taylor Guardian",
            email: "taylor@example.org",
            role: "guardian",
          },
          organization: { slug: "northstar", displayName: "Northstar Academy" },
        });
      }
      if (url === "/api/organization/guardian/students") {
        return jsonResponse({
          students: [{
            id: "student-42",
            name: "Alex Student",
            requiredConsents: [{
              type: "ai_interaction",
              label: "AI interaction consent",
              policyVersion: "2026.1",
              granted: false,
              purpose: "Use AI to provide counseling suggestions.",
              dataCategories: ["Counseling prompts"],
              recipients: ["AI service provider"],
              internationalTransfers: "No international transfer.",
              retention: "Prompts are deleted within 30 days.",
              rights: ["Access", "Export", "Correction", "Revoke consent", "Delete"],
              policyUrl: "javascript:alert('unsafe')",
            }],
          }],
        });
      }
      throw new Error(`Unexpected request: GET ${url}`);
    }));

    render(<OrganizationApp />);
    expect(await screen.findByText("AI interaction consent")).toBeVisible();
    expect(screen.getByText("Review unavailable")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Grant consent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /read the full policy/i })).not.toBeInTheDocument();
  });

  it("shows a defensive authentication error and keeps cookie credentials same-origin", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/session") {
        return jsonResponse({ authenticated: false });
      }
      if (url === "/api/organization/auth") {
        expect(options.credentials).toBe("same-origin");
        return jsonResponse({ error: { message: "Invalid organization credentials." } }, { status: 401 });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationApp />);
    expect(await screen.findByRole("heading", { name: "Organization sign in" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "northstar" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@northstar.org" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "incorrect password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid organization credentials.");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("restores a cookie session while keeping CSRF and session tokens out of browser storage", async () => {
    const localStorageSpy = vi.spyOn(window.localStorage, "setItem");
    const sessionStorageSpy = vi.spyOn(window.sessionStorage, "setItem");
    let sessionReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/organization/session") {
        sessionReads += 1;
        return jsonResponse({
          ...adminSession,
          token: "must-not-persist-or-render",
        });
      }
      if (url === "/api/organization/members") return jsonResponse({ members: [] });
      if (url === "/api/organization/invitations") return jsonResponse({ invitations: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(
      <React.StrictMode>
        <OrganizationApp />
      </React.StrictMode>,
    );
    expect(await screen.findByRole("heading", { name: "Northstar Academy" })).toBeVisible();
    expect(sessionReads).toBe(1);
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("csrf-admin-memory-only");
    expect(document.body).not.toHaveTextContent("must-not-persist-or-render");
  });

  it("changes the authenticated organization password with in-memory CSRF and clears the fields", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/session") return jsonResponse(adminSession);
      if (url === "/api/organization/members") return jsonResponse({ members: [] });
      if (url === "/api/organization/invitations") return jsonResponse({ invitations: [] });
      if (url === "/api/organization/password") {
        expect(options.method).toBe("PUT");
        expect(options.credentials).toBe("same-origin");
        expect(options.headers["X-CSRF-Token"]).toBe("csrf-admin-memory-only");
        expect(requestBody([url, options])).toEqual({
          currentPassword: "old correct password",
          newPassword: "new correct password",
        });
        return jsonResponse({ changed: true, csrfToken: "rotated-csrf-memory-only" });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationApp />);
    expect(await screen.findByRole("heading", { name: "Account security" })).toBeVisible();
    const currentPassword = screen.getByLabelText("Current password");
    const newPassword = screen.getByLabelText("New password");
    const confirmPassword = screen.getByLabelText("Confirm new password");
    fireEvent.change(currentPassword, { target: { value: "old correct password" } });
    fireEvent.change(newPassword, { target: { value: "new correct password" } });
    fireEvent.change(confirmPassword, { target: { value: "new correct password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Password updated");
    expect(currentPassword).toHaveValue("");
    expect(newPassword).toHaveValue("");
    expect(confirmPassword).toHaveValue("");
    expect(document.body).not.toHaveTextContent("rotated-csrf-memory-only");
  });

  it("requests a password reset with a generic account-enumeration-safe confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/session") return jsonResponse({ authenticated: false });
      if (url === "/api/organization/password-reset/request") {
        expect(options.method).toBe("POST");
        expect(options.credentials).toBe("same-origin");
        expect(options.headers).not.toHaveProperty("X-CSRF-Token");
        expect(requestBody([url, options])).toEqual({ email: "member@example.org" });
        return jsonResponse({ accepted: true }, { status: 202 });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OrganizationApp />);
    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    expect(await screen.findByRole("heading", { name: "Reset organization password" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "member@example.org" } });
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an organization account matches that email, a password reset link will be sent.",
    );
  });

  it("captures and scrubs a reset credential, completes the reset, and returns to sign in without persistence", async () => {
    const localStorageSpy = vi.spyOn(window.localStorage, "setItem");
    const sessionStorageSpy = vi.spyOn(window.sessionStorage, "setItem");
    const consoleSpies = ["log", "info", "warn", "error"].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}));
    window.history.replaceState(null, "", "/organization.html?reset=reset-secret-456&campaign=summer#finish");
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === "/api/organization/password-reset/complete") {
        expect(options.method).toBe("POST");
        expect(options.credentials).toBe("same-origin");
        expect(options.headers).not.toHaveProperty("X-CSRF-Token");
        expect(requestBody([url, options])).toEqual({
          token: "reset-secret-456",
          email: "member@example.org",
          newPassword: "new correct password",
        });
        return jsonResponse({ completed: true });
      }
      throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <React.StrictMode>
        <OrganizationApp />
      </React.StrictMode>,
    );
    expect(await screen.findByRole("heading", { name: "Choose a new organization password" })).toBeVisible();
    expect(window.location.pathname).toBe("/organization.html");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#finish");
    expect(document.body).not.toHaveTextContent("reset-secret-456");

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "member@example.org" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new correct password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new correct password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/organization/password-reset/complete",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByRole("heading", { name: "Organization sign in" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Password reset complete");
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
    const loggedText = consoleSpies.flatMap((spy) => spy.mock.calls).flat().join(" ");
    expect(loggedText).not.toContain("reset-secret-456");
  });
});
