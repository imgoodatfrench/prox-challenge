"use client";

import type { RenderPart } from "@/lib/types";
import TextPart from "./TextPart";
import ManualImagePart from "./ManualImagePart";
import DiagramFrame from "./DiagramFrame";
import ArtifactFrame from "./ArtifactFrame";

// Walks one assistant message's ordered parts and renders each with the right
// component — this is the multimodal "assembly" the agent's answer is built from.
export default function MessageParts({ parts }: { parts: RenderPart[] }) {
  return (
    <div className="parts">
      {parts.map((part, i) => {
        switch (part.kind) {
          case "text":
            return part.text.trim() ? <TextPart key={i} text={part.text} /> : null;
          case "manual_image":
            return (
              <div key={i} className="part-card">
                <div className="part-head">
                  <span>Manual image</span>
                  <span>{part.doc ? `${part.doc} p.${part.page}` : part.id}</span>
                </div>
                <div className="part-body manual-image-body">
                  <ManualImagePart part={part} />
                </div>
              </div>
            );
          case "diagram":
            return (
              <div key={i} className="part-card diagram-part">
                <div className="part-head">
                  <span>Diagram</span>
                  <span>{part.title}</span>
                </div>
                <div className="part-body">
                  <DiagramFrame svg={part.svg} />
                </div>
              </div>
            );
          case "artifact":
            return (
              <div key={i} className="part-card">
                <div className="part-head">
                  <span>Interactive · {part.runtime}</span>
                  <span>{part.title}</span>
                </div>
                <div className="part-body">
                  <ArtifactFrame code={part.code} runtime={part.runtime} />
                </div>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
