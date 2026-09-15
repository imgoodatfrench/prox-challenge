// Unit tests for the per-turn guards. No API key required.
//   node --experimental-strip-types lib/turn-guards.test.ts
import assert from "node:assert/strict";
import { checkToolsReady, isMissingSessionError, REQUIRED_TOOLS } from "./turn-guards.ts";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

console.log("turn guards");

const allTools = [...REQUIRED_TOOLS];

check("ready when server connected and all four tools registered", () => {
  const r = checkToolsReady({ tools: allTools, mcp_servers: [{ name: "manual", status: "connected" }] });
  assert.equal(r.ok, true);
});

check("not ready when the manual server failed to connect", () => {
  const r = checkToolsReady({ tools: [], mcp_servers: [{ name: "manual", status: "failed" }] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /status is 'failed'/);
});

check("not ready while the manual server is still pending", () => {
  const r = checkToolsReady({ tools: [], mcp_servers: [{ name: "manual", status: "pending" }] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /pending/);
});

check("not ready when the server is missing from init entirely", () => {
  const r = checkToolsReady({ tools: allTools, mcp_servers: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /not registered/);
});

check("not ready when connected but a tool is absent (e.g. deferred behind tool search)", () => {
  const r = checkToolsReady({
    tools: allTools.filter((t) => t !== "mcp__manual__render_diagram"),
    mcp_servers: [{ name: "manual", status: "connected" }],
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /render_diagram/);
});

check("tolerates an init message with no tool/server fields", () => {
  const r = checkToolsReady({});
  assert.equal(r.ok, false);
});

check("recognises the SDK's missing-session error text", () => {
  assert.equal(
    isMissingSessionError(
      "Claude Code returned an error result: No conversation found with session ID: 1111-2222",
    ),
    true,
  );
});

check("does not treat other errors as a missing session", () => {
  assert.equal(isMissingSessionError("Claude Code returned an error result: rate limited"), false);
  assert.equal(isMissingSessionError("kb/manual.md not found"), false);
  assert.equal(isMissingSessionError(""), false);
});

console.log(`${n} checks passed`);
