import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

describe("App boot", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok:true, json:async()=>({}) }));
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("routes to the login screen on mount instead of hanging on the loading state", async () => {
    render(<App />);

    expect(await screen.findByText("Welcome back")).toBeVisible();
    expect(screen.queryByText("Loading your vault...")).not.toBeInTheDocument();
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
});
