const esbuild = require("esbuild");
const path = require("path");
esbuild.build({
  entryPoints: [path.join(__dirname, "src/index.jsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  external: ["react", "react-dom", "react/jsx-runtime"],
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  outfile: path.join(__dirname, "dist/index.js"),
  banner: { js: "/* web-chat plugin — v1.0.0 */" },
  logLevel: "info",
}).then(() => {
  const fs = require("fs");
  const stat = fs.statSync(path.join(__dirname, "dist/index.js"));
  console.log(`Built dist/index.js — ${(stat.size / 1024).toFixed(1)} KB`);
}).catch(() => process.exit(1));
