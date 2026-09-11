"use client";

import type { Part } from "@/lib/types";

type ManualImage = Extract<Part, { kind: "manual_image" }>;

export default function ManualImagePart({ part }: { part: ManualImage }) {
  const citation =
    part.doc && part.page != null ? `${part.doc} — p.${part.page}` : part.id;
  return (
    <div className="manual-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={part.src} alt={part.caption} loading="lazy" />
      <div className="caption">
        {part.caption} <span style={{ opacity: 0.7 }}>({citation})</span>
      </div>
    </div>
  );
}
