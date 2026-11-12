import test from "node:test";
import assert from "node:assert/strict";
import { resolveApiBase } from "./apiBase.js";

const productionBase = "https://tools-backend-v3um.onrender.com";

test("installed production apps use the live server when .env contains a loopback address", () => {
  for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "http://api.localhost:3000"]) {
    assert.equal(resolveApiBase({ PROD: true, VITE_API_BASE_URL: url }), productionBase);
  }
  assert.equal(resolveApiBase({ PROD: true }), productionBase);
});

test("development keeps its local server and custom remote deployments remain configurable", () => {
  assert.equal(resolveApiBase(), "http://localhost:3000");
  assert.equal(resolveApiBase({ PROD: false, VITE_API_BASE_URL: "http://localhost:4000/" }), "http://localhost:4000");
  assert.equal(resolveApiBase({ PROD: true, VITE_API_BASE_URL: " https://api.example.com/ " }), "https://api.example.com");
});
