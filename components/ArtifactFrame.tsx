"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildArtifactSrcDoc, type ArtifactRuntime } from "@/lib/artifact-template";

export default function ArtifactFrame({
  code,
  runtime,
}: {
  code: string;
  runtime: ArtifactRuntime;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [error, setError] = useState<string | null>(null);

  const srcDoc = useMemo(() => buildArtifactSrcDoc(code, runtime), [code, runtime]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Opaque-origin sandbox → e.origin is "null"; trust by frame, not origin.
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      const data = e.data as { type?: string; height?: number; message?: string };
      if (data?.type === "artifact-height" && typeof data.height === "number") {
        setHeight(Math.min(Math.max(data.height, 60), 2000));
      } else if (data?.type === "artifact-error") {
        setError(data.message || "Artifact failed to run");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div>
      <iframe
        ref={ref}
        className="artifact-frame"
        // No allow-same-origin: the frame gets an opaque origin and cannot
        // touch this page's DOM, cookies, or storage.
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ height }}
        title="Interactive artifact"
      />
      {error && (
        <div className="artifact-error">
          ⚠ This interactive piece hit an error: {error}
        </div>
      )}
    </div>
  );
}
