import { isAbsolute } from "node:path";
import { rolldown } from "rolldown";

// Bundle workspace TypeScript before Vercel traces the function. Retain normal package imports
// for native dependencies and packages that use their own files at runtime.
const bundle = await rolldown({
  input: "deploy/vercel/entry.ts",
  platform: "node",
  // entities is also installed transitively at another version at the monorepo root.
  external: id => !id.startsWith("@aihot/") && !/^entities(?:\/|$)/.test(id) && !id.startsWith(".") && !isAbsolute(id),
});
// The server resolves its repository assets three directories above import.meta.dirname.
await bundle.write({ file: "deploy/vercel/runtime/radar.mjs", format: "esm", codeSplitting: false });
await bundle.close();
