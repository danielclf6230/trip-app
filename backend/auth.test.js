import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { loginHandler } from "./auth.js";

const passwordHash = bcrypt.hashSync("test-password", 4);
test("only an explicit Remember me login receives a 30-day session; default sessions remain eight hours", async t => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-secret-not-for-production-123456";
  t.after(() => { if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original; });
  const pool = { query: async () => [[{ id: 1, name: "Traveler", password: passwordHash, role: "user" }]] };
  for (const [remember, hours] of [[undefined, 8], [false, 8], ["true", 8], [true, 30 * 24]]) {
    let response;
    const res = { json: value => { response = value; }, status: () => res };
    await loginHandler({ body: { name: "Traveler", password: "test-password", remember } }, res, pool);
    const payload = jwt.verify(response.token, process.env.JWT_SECRET, { issuer: "trip-tools-api", audience: "trip-tools-web" });
    assert.equal(payload.exp - payload.iat, hours * 3600);
    assert.equal(response.password, undefined);
  }
});
