"use client";

import { useMemo } from "react";

// Renders model-generated SVG inside a fully locked iframe: sandbox="" means NO
// scripts run and the frame has an opaque origin, so even markup that slipped
// past server-side sanitizing cannot execute or reach this page. We size the
// frame from the SVG's own viewBox aspect ratio (no script needed).
export default function DiagramFrame({ svg }: { svg: string }) {
  const { srcDoc, ratio } = useMemo(() => {
    const vb = svg.match(/viewBox\s*=\s*["']\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)/i);
    let r = 0.6; // fallback height/width
    if (vb) {
      const w = parseFloat(vb[3]);
      const h = parseFloat(vb[4]);
      if (w > 0 && h > 0) r = h / w;
    }
    const doc = `<!doctype html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
<style>html,body{margin:0;padding:0;background:#fff}svg{display:block;width:100%;height:auto}</style>
</head><body>${svg}</body></html>`;
    return { srcDoc: doc, ratio: r };
  }, [svg]);

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: `1 / ${ratio}` }}>
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        title="Diagram"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#fff", borderRadius: 6 }}
      />
    </div>
  );
}
