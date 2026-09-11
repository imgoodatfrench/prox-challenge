"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders assistant prose as Markdown (GFM tables/lists). Links open safely in
// a new tab; react-markdown does not render raw HTML, so model text is inert.
export default function TextPart({ text }: { text: string }) {
  return (
    <div className="text-part">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
