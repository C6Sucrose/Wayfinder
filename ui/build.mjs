import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

await build({
  entryPoints: ["ui/src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
  outfile: "ui-out.js",
  loader: { ".css": "text" }
}).then((result) => {
  const js = result.outputFiles[0].text;
  const css = readFileSync("ui/src/styles.css", "utf8");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wayfinder</title><style>${css}</style></head>
<body><main id="root" role="main" aria-live="polite"></main><script>${js}</script></body>
</html>`;
  mkdirSync("dist/ui", { recursive: true });
  writeFileSync("dist/ui/app.html", html, "utf8");
  console.log(`[ui] wrote dist/ui/app.html (${html.length} bytes)`);
});
