import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://127.0.0.1:3000" }),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { getSession: async () => ({ user: { id: "user-1" } }) },
  }),
}));
import { canRemove } from "@/lib/permissions";
import { logUnexpected, redact } from "@/lib/log";
import { api } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { personLabel } from "@/lib/approval-contracts";
const leaky = Object.assign(
  new Error(
    'duplicate key value violates unique constraint "user_email" for client@example.test',
  ),
  {
    code: "23505",
    detail: "Key (email)=(client@example.test) already exists.",
  },
);
afterEach(() => vi.restoreAllMocks());
describe("member removal policy", () => {
  it("follows invitation rules, allows leaving, and protects the owner", () => {
    expect(canRemove("owner", "admin", false)).toBe(true);
    expect(canRemove("owner", "member", false)).toBe(true);
    expect(canRemove("admin", "member", false)).toBe(true);
    expect(canRemove("admin", "admin", false)).toBe(false);
    expect(canRemove("member", "member", false)).toBe(false);
    expect(canRemove("member", "member", true)).toBe(true);
    expect(canRemove("admin", "admin", true)).toBe(true);
    for (const role of ["owner", "admin", "member"] as const) {
      expect(canRemove(role, "owner", false)).toBe(false);
      expect(canRemove(role, "owner", true)).toBe(false);
    }
  });
});
describe("identity display", () => {
  it("always pairs the editable name with the immutable email", () => {
    expect(personLabel("Workspace Owner", "admin@agency.example")).toBe(
      "Workspace Owner (admin@agency.example)",
    );
    expect(personLabel(null, "a@agency.example")).toBe("a@agency.example");
    expect(personLabel("Someone", null)).toBe("an unknown user");
  });
});
describe("error logging", () => {
  it("redacts quoted values, emails and key details", () => {
    const value = redact(
      'insert "Top secret plan" for ceo@agency.example failed: (email)=(ceo@agency.example)',
    );
    expect(value).not.toContain("Top secret");
    expect(value).not.toContain("ceo@agency.example");
    expect(redact("x".repeat(2000))).toHaveLength(500);
  });
  it("logs one JSON line with diagnostics only and returns its reference", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reference = logUnexpected("test.failure", leaky, { path: "/api/x" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "error",
      event: "test.failure",
      reference,
      code: "23505",
      path: "/api/x",
    });
    const text = JSON.stringify(line);
    expect(text).not.toContain("client@example.test");
    expect(text).not.toContain("detail");
    expect(text).not.toContain("user_email");
  });
  it("API failures return a reference that matches the log, without internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await api(
      new Request("http://127.0.0.1:3000/api/workspaces/x"),
      async () => {
        throw leaky;
      },
    );
    expect(response.status).toBe(409);
    expect(spy).not.toHaveBeenCalled();
    const unexpected = await api(
      new Request("http://127.0.0.1:3000/api/workspaces/x"),
      async () => {
        throw new Error("connect ECONNREFUSED for ceo@agency.example");
      },
    );
    expect(unexpected.status).toBe(503);
    const result = await unexpected.json();
    expect(result.reference).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.error).toContain("Reference: " + result.reference);
    expect(result.error).not.toContain("ECONNREFUSED");
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      event: "api.unexpected_error",
      reference: result.reference,
      method: "GET",
      path: "/api/workspaces/x",
    });
    expect(JSON.stringify(line)).not.toContain("ceo@agency.example");
  });
  it("expected refusals are not logged as errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await api(
      new Request("http://127.0.0.1:3000/api/workspaces/x"),
      async () => {
        throw new AppError(403, "No.");
      },
    );
    expect(response.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});
