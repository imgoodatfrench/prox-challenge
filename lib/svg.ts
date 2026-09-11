// SVG hardening for model-generated diagrams.
//
// Defense in depth. The PRIMARY control is that DiagramFrame renders this SVG
// inside an iframe with `sandbox=""` (no allow-scripts, opaque origin), so even
// a `<script>` that slipped through cannot execute or touch the parent page.
// This pass is a second layer: strip the obvious active-content vectors and
// reject anything that still looks executable, so we never render a diagram we
// can't reason about.

const DANGEROUS_TAG = /<\s*(script|foreignObject|iframe|object|embed|animate|animateTransform|animateMotion|set|handler)\b[^>]*>/i;
// on*="..." event handlers (only when they appear as an attribute inside a tag,
// so ordinary label text like "phase one=A" isn't a false positive), plus
// javascript: URLs and href/xlink:href to scripts.
const EVENT_HANDLER = /<[^>]*\son[a-z]+\s*=/i;
const JS_URL = /(?:href|xlink:href|src)\s*=\s*["']?\s*(?:javascript|data:text\/html|vbscript):/i;

export interface SanitizeResult {
  ok: boolean;
  svg: string;
  reason?: string;
}

/**
 * Validate + lightly clean a model-supplied SVG string. Returns ok:false with a
 * reason (surfaced to the model so it can regenerate) when the input is not a
 * plausible, safe standalone SVG.
 */
export function sanitizeSvg(input: string): SanitizeResult {
  const svg = input.trim();

  if (!svg) return { ok: false, svg: "", reason: "empty svg" };
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    return { ok: false, svg, reason: "must be a single <svg>…</svg> element" };
  }
  if (svg.length > 200_000) {
    return { ok: false, svg, reason: "svg too large (>200KB)" };
  }
  if (DANGEROUS_TAG.test(svg)) {
    return { ok: false, svg, reason: "contains disallowed active element (script/animation/etc.)" };
  }
  if (EVENT_HANDLER.test(svg)) {
    return { ok: false, svg, reason: "contains inline event handler (on*=)" };
  }
  if (JS_URL.test(svg)) {
    return { ok: false, svg, reason: "contains javascript:/data:text/html URL" };
  }

  return { ok: true, svg };
}
