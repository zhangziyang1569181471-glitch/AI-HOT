import { isAbsolute } from "node:path";
import { rolldown } from "rolldown";

const sanitizerPackages = new Set([
  "sanitize-html", "htmlparser2", "entities", "escape-string-regexp", "is-plain-object",
  "launder", "dayjs", "parse-srcset", "postcss", "nanoid", "picocolors", "source-map-js",
]);
// Bundle workspace TypeScript before Vercel traces the function. Retain normal package imports
// for native dependencies and packages that use their own files at runtime.
const bundle = await rolldown({
  input: "deploy/vercel/entry.ts",
  platform: "node",
  // Resolve the sanitizer's CommonJS-to-ESM imports and per-workspace entities version at build time.
  external: id => !id.startsWith("@aihot/") && !sanitizerPackages.has(id.split("/")[0])
    && !id.startsWith(".") && !isAbsolute(id),
});
// The server resolves its repository assets three directories above import.meta.dirname.
await bundle.write({ file: "deploy/vercel/runtime/radar.mjs", format: "esm", codeSplitting: false });
await bundle.close();
