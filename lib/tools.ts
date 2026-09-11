import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Part } from "./types";
import { resolvePageImage, readImageBase64, type ResolvedImage } from "./image";
import { sanitizeSvg } from "./svg";

// Server (MCP) name → tools are exposed to the model as mcp__manual__<tool>.
export const MANUAL_SERVER = "manual";
export const MANUAL_TOOL_NAMES = [
  "mcp__manual__get_page_image",
  "mcp__manual__show_manual_image",
  "mcp__manual__render_diagram",
  "mcp__manual__render_artifact",
];

/** How the client reaches a page PNG (served by app/api/manual-image). */
function imageSrc(id: string): string {
  return `/api/manual-image?id=${encodeURIComponent(id)}`;
}

/**
 * Build the in-process MCP server holding the four multimodal tools. Each tool
 * is a closure over `emit`, which pushes an ordered UI part onto the current
 * request's SSE stream. Tools run inline within the query() iteration, so the
 * parts they emit interleave with streamed text in the exact order the model
 * produced them.
 */
export function createManualServer(emit: (part: Part) => void) {
  const getPageImage = tool(
    "get_page_image",
    "Fetch the rendered PNG of a specific manual page so YOU (the model) can look " +
      "closely at a figure, table, schematic, or chart before answering. Use this " +
      "when the manual text references a diagram whose fine detail matters. Returns " +
      "the image to you; it is NOT shown to the user (use show_manual_image for that). " +
      "Reference the page by its id (e.g. 'owner-manual-p12') or by doc + page number.",
    {
      id: z.string().optional().describe("page id like 'owner-manual-p12'"),
      doc: z
        .enum(["owner-manual", "quick-start-guide", "selection-chart"])
        .optional()
        .describe("document slug; defaults to owner-manual"),
      page: z.number().int().optional().describe("1-based page number within the doc"),
    },
    async (args) => {
      const img = resolvePageImage(args);
      if (!img || !img.exists) {
        return errorResult(
          `No page image for ${describeRef(args)}. Check the id/page against the manual.`,
        );
      }
      return {
        content: [
          {
            type: "image" as const,
            data: readImageBase64(img),
            mimeType: img.mimeType,
          },
          {
            type: "text" as const,
            text: `Loaded ${img.docTitle} p.${img.page} (${img.id}) for inspection.`,
          },
        ],
      };
    },
  );

  const showManualImage = tool(
    "show_manual_image",
    "Show an actual page image from the manual to the USER, inline in the chat, with " +
      "a caption/citation. Use this when the answer is best backed by the real figure — " +
      "the wire-feed mechanism, the front-panel controls, the weld-diagnosis photos, the " +
      "wiring schematic, the process-selection chart. Reference the page by id or doc+page. " +
      "Write a short caption telling the user what to look at.",
    {
      id: z.string().optional().describe("page id like 'owner-manual-p23'"),
      doc: z
        .enum(["owner-manual", "quick-start-guide", "selection-chart"])
        .optional(),
      page: z.number().int().optional(),
      caption: z.string().describe("one-line caption / what to notice in the image"),
    },
    async (args) => {
      const img = resolvePageImage(args);
      if (!img || !img.exists) {
        return errorResult(
          `No page image for ${describeRef(args)}; cannot show it. Do not claim it was shown.`,
        );
      }
      emit({
        kind: "manual_image",
        id: img.id,
        src: imageSrc(img.id),
        caption: args.caption,
        doc: img.docTitle,
        page: img.page,
      });
      return textResult(
        `Displayed ${img.docTitle} p.${img.page} to the user with caption: "${args.caption}". ` +
          `You do not need to re-describe the whole image; reference it and continue.`,
      );
    },
  );

  const renderDiagram = tool(
    "render_diagram",
    "Draw a custom explanatory diagram as inline SVG and show it to the user. Use this " +
      "for things that are clearer drawn than described: polarity / cable-into-socket " +
      "setups, gas and cable routing, torch/gun anatomy, connection order. Provide a " +
      "COMPLETE, self-contained <svg> with a viewBox, readable labels, and enough detail " +
      "to act on. No <script>, animations, or event handlers.",
    {
      title: z.string().describe("short title shown above the diagram"),
      svg: z.string().describe("a complete standalone <svg>…</svg> string with a viewBox"),
    },
    async (args) => {
      const clean = sanitizeSvg(args.svg);
      if (!clean.ok) {
        return errorResult(
          `Diagram rejected: ${clean.reason}. Send one complete <svg> with a viewBox, ` +
            `no scripts/animations/event handlers.`,
        );
      }
      emit({ kind: "diagram", title: args.title, svg: clean.svg });
      return textResult(`Diagram "${args.title}" rendered for the user.`);
    },
  );

  const renderArtifact = tool(
    "render_artifact",
    "Generate an INTERACTIVE artifact (a small app) and embed it in the chat — the right " +
      "choice when a question needs computation or exploration rather than a static answer: " +
      "a duty-cycle calculator, a troubleshooting flowchart/decision tree, a settings " +
      "configurator (process + material + thickness → wire speed & voltage). " +
      "For runtime 'react', write a single function component named `App` (JSX allowed; " +
      "React hooks are in scope as useState/useEffect/etc.); do not import anything and do " +
      "not include <script> tags. For runtime 'html', provide an HTML fragment. Bake the " +
      "real numbers from the manual into the artifact.",
    {
      title: z.string().describe("short title shown above the artifact"),
      runtime: z.enum(["react", "html"]).describe("'react' for a component named App, else 'html'"),
      code: z
        .string()
        .describe("component/HTML source; for react, defines `function App() { ... }`"),
    },
    async (args) => {
      const code = args.code.trim();
      if (!code) return errorResult("Artifact code was empty.");
      if (args.runtime === "react" && !/\bApp\b/.test(code)) {
        return errorResult(
          "React artifact must define a component named `App`. Rename your component to App.",
        );
      }
      if (/<\/script\s*>/i.test(code)) {
        return errorResult("Do not include </script> in artifact code.");
      }
      emit({ kind: "artifact", title: args.title, runtime: args.runtime, code });
      return textResult(
        `Interactive artifact "${args.title}" (${args.runtime}) embedded for the user. ` +
          `Briefly tell them what it does and how to use it.`,
      );
    },
  );

  return createSdkMcpServer({
    name: MANUAL_SERVER,
    version: "1.0.0",
    tools: [getPageImage, showManualImage, renderDiagram, renderArtifact],
  });
}

// --- small helpers for MCP CallToolResult shapes ---
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
function describeRef(args: { id?: string; doc?: string; page?: number }): string {
  if (args.id) return `id '${args.id}'`;
  return `${args.doc || "owner-manual"} p.${args.page ?? "?"}`;
}

// re-exported for callers that want to preflight without importing image.ts
export type { ResolvedImage };
