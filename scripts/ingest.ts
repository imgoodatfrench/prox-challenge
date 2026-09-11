// Extraction pipeline CLI.  Usage:
//   node scripts/ingest.ts [render|extract|bundle|all|status] [flags]
// Flags: --force  --only <slug>  --pages <lo-hi>  --concurrency <n>  --dpi <n>
// Only 'extract' needs ANTHROPIC_API_KEY (loaded from .env). See docs/EXTRACTION.md.
import path from "node:path";
import {
  DOCS,
  FILES_DIR,
  IMAGES_DIR,
  PAGES_DIR,
  MANUAL_MD,
  MANIFEST_JSON,
} from "./lib/config.ts";
import { exists, loadDotEnv, log, pad2, pageId } from "./lib/util.ts";
import { pageCount, render } from "./lib/render.ts";
import { extract } from "./lib/extract.ts";
import { bundle } from "./lib/bundle.ts";

interface Args {
  command: string;
  force: boolean;
  only?: string;
  pages?: [number, number];
  concurrency?: number;
  dpi?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: argv[0]?.startsWith("--") ? "all" : (argv[0] ?? "all"), force: false };
  const rest = args.command === argv[0] ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--force") args.force = true;
    else if (a === "--only") args.only = rest[++i];
    else if (a === "--concurrency") args.concurrency = parseInt(rest[++i], 10);
    else if (a === "--dpi") args.dpi = parseInt(rest[++i], 10);
    else if (a === "--pages") {
      const m = rest[++i]?.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(`bad --pages value (want e.g. 7 or 10-24)`);
      args.pages = [parseInt(m[1], 10), parseInt(m[2] ?? m[1], 10)];
    } else if (a === "--help" || a === "-h") {
      args.command = "help";
    } else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

function status(): void {
  log("Extraction status\n");
  log("  stage       done");
  for (const doc of DOCS) {
    const total = exists(path.join(FILES_DIR, doc.pdf))
      ? pageCount(path.join(FILES_DIR, doc.pdf))
      : 0;
    let rendered = 0;
    let extracted = 0;
    for (let p = 1; p <= total; p++) {
      const id = pageId(doc.slug, p);
      if (exists(path.join(IMAGES_DIR, `${id}.png`))) rendered++;
      if (exists(path.join(PAGES_DIR, `${id}.md`))) extracted++;
    }
    log(`  ${doc.slug.padEnd(18)} render ${pad2(rendered)}/${pad2(total)}   extract ${pad2(extracted)}/${pad2(total)}`);
  }
  log("");
  log(`  bundle: manual.md ${exists(MANUAL_MD) ? "✓" : "—"}   manifest.json ${exists(MANIFEST_JSON) ? "✓" : "—"}`);
}

const HELP = `prox extraction pipeline

  node scripts/ingest.ts <command> [flags]

commands:
  all       render → extract → bundle (default)
  render    PDF pages → kb/images/*.png       (ghostscript, no API key)
  extract   page images → kb/pages/*.md       (Claude vision, needs ANTHROPIC_API_KEY)
  bundle    pages → kb/manual.md + manifest    (deterministic, no API key)
  status    show per-stage progress

flags:
  --force            ignore existing output and redo
  --only <slug>      limit to one document (${DOCS.map((d) => d.slug).join(", ")})
  --pages <lo-hi>    limit to a page range, e.g. --pages 10-24
  --concurrency <n>  parallel extract calls (default 4)
  --dpi <n>          render resolution (default 150)`;

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "help":
      log(HELP);
      break;
    case "status":
      status();
      break;
    case "render":
      render(args);
      break;
    case "extract":
      await extract(args);
      break;
    case "bundle":
      bundle();
      break;
    case "all":
      render(args);
      await extract(args);
      bundle();
      break;
    default:
      throw new Error(`unknown command "${args.command}". Try: node scripts/ingest.ts help`);
  }
}

main().catch((err) => {
  console.error(`\ningest failed: ${(err as Error).message}`);
  process.exit(1);
});
