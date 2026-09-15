// Pure, dependency-free checks the /api/chat route applies to each turn.
// Kept separate from agent.ts so they can be unit-tested with plain node
// (agent.ts pulls in the Agent SDK and Next-style extensionless imports).

/** The four multimodal tools the model must see on every turn. */
export const REQUIRED_TOOLS = [
  "mcp__manual__get_page_image",
  "mcp__manual__show_manual_image",
  "mcp__manual__render_diagram",
  "mcp__manual__render_artifact",
] as const;

export interface InitSnapshot {
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
}

export interface ToolsReady {
  ok: boolean;
  reason?: string;
}

/**
 * Inspect the SDK's `system/init` message and confirm the in-process MCP
 * server is connected AND all four tools are registered for this turn.
 *
 * Why: MCP startup in the Claude Code runtime is non-blocking. If the
 * in-process server hasn't finished its handshake when the first model call
 * goes out, the model's tool calls come back as "Its MCP server 'manual' is
 * still connecting / not available in this context. Continue without this
 * tool." — which the model paraphrases to the user as "my drawing tools
 * aren't responding". We'd rather surface that loudly than let the answer
 * silently degrade to text.
 */
export function checkToolsReady(init: InitSnapshot, serverName = "manual"): ToolsReady {
  const server = (init.mcp_servers ?? []).find((s) => s.name === serverName);
  if (!server) return { ok: false, reason: `MCP server '${serverName}' is not registered` };
  if (server.status !== "connected") {
    return { ok: false, reason: `MCP server '${serverName}' status is '${server.status}'` };
  }
  const have = new Set(init.tools ?? []);
  const missing = REQUIRED_TOOLS.filter((t) => !have.has(t));
  if (missing.length) return { ok: false, reason: `tools not registered: ${missing.join(", ")}` };
  return { ok: true };
}

/**
 * True when a thrown error (or error-result text) means the session we tried
 * to resume no longer exists on this server — e.g. the client kept an
 * `sdkSessionId` from before a redeploy/restart (Railway's filesystem is
 * ephemeral, so ~/.claude session transcripts don't survive one). The right
 * recovery is to start a fresh session, not to fail the turn forever.
 */
export function isMissingSessionError(detail: string): boolean {
  return /No conversation found with session ID/i.test(detail);
}
