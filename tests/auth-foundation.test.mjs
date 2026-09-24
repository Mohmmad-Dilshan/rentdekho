import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  assertOwnership,
  assertRole,
  AuthorizationError,
} from "../src/server/auth/authorization-rules.ts";

function createRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("origin", "http://localhost:3000");

  return new Request(`http://localhost:3000/api/auth${path}`, {
    ...options,
    headers,
  });
}

test("email/password sign-up creates a session and sign-out invalidates it", async () => {
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-only-secret-that-is-never-used-by-the-application",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: {
      enabled: true,
    },
  });

  const anonymousSessionResponse = await auth.handler(
    createRequest("/get-session"),
  );
  assert.equal(anonymousSessionResponse.status, 200);
  assert.equal(await anonymousSessionResponse.json(), null);

  const signUpResponse = await auth.handler(
    createRequest("/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@example.com",
        password: "a-safe-test-password",
      }),
    }),
  );

  assert.equal(signUpResponse.status, 200);
  const cookie = signUpResponse.headers.get("set-cookie");
  assert.ok(cookie);

  const sessionResponse = await auth.handler(
    createRequest("/get-session", { headers: { cookie } }),
  );
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.user.email, "test@example.com");

  const signOutResponse = await auth.handler(
    createRequest("/sign-out", {
      method: "POST",
      headers: { cookie },
    }),
  );
  assert.equal(signOutResponse.status, 200);

  const invalidatedSessionResponse = await auth.handler(
    createRequest("/get-session", { headers: { cookie } }),
  );
  assert.equal(invalidatedSessionResponse.status, 200);
  assert.equal(await invalidatedSessionResponse.json(), null);
});

test("authorization rejects an unauthorized role and mismatched ownership", () => {
  assert.doesNotThrow(() => assertRole("OWNER", ["OWNER", "ADMIN"]));
  assert.throws(() => assertRole("TENANT", ["ADMIN"]), AuthorizationError);
  assert.doesNotThrow(() => assertOwnership("user-1", "user-1"));
  assert.throws(() => assertOwnership("user-1", "user-2"), AuthorizationError);
});
