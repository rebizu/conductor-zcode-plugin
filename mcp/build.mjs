// Build: bundle the MCP server (single ESM file) and the panel UI (single
// self-contained HTML) into mcp/dist/. Runtime needs only dist/ + Node.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

// 1. server — bundle everything (SDK + zod) into one ESM file
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
await esbuild.build({
  entryPoints: [path.join(root, "src/server.mjs")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: path.join(dist, "server.mjs"),
  sourcemap: false,
  logLevel: "info",
  define: { __CONDUCTOR_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    // esbuild-bundled deps may use import.meta.url / createRequire patterns
    js: `import { createRequire as __crc } from "node:module"; const require = __crc(import.meta.url);`,
  },
});

// 2. panel — bundle the page script, inline into the HTML template
const res = await esbuild.build({
  entryPoints: [path.join(root, "src/panel/main.mjs")],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  write: false,
  minify: true,
  logLevel: "info",
});
const js = res.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, "src/panel/panel.css"), "utf-8");
const template = fs.readFileSync(path.join(root, "src/panel/index.html"), "utf-8");
const html = template.replace("{{CSS}}", () => css).replace("{{JS}}", () => js);
const out = path.join(dist, "panel.html");
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`panel.html: ${kb} KiB (host limit 4 MiB)`);
if (fs.statSync(out).size > 4 * 1024 * 1024) {
  console.error("panel.html exceeds the 4 MiB resource cap");
  process.exit(1);
}
