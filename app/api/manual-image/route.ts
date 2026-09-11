import { readFileSync } from "node:fs";
import { resolvePageImage } from "@/lib/image";

// Serves a single manual page PNG from kb/images by page id. The resolver
// guards against path traversal (id must map to a file inside kb/images).
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const img = resolvePageImage({ id });
  if (!img || !img.exists) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = readFileSync(img.absPath);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": img.mimeType,
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
