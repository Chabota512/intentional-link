import path from "path";
  import { fileURLToPath } from "url";
  import { build as esbuild } from "esbuild";
  import { rm } from "fs/promises";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const workspaceRoot = path.resolve(__dirname, "../..");

  async function buildAll() {
    const distDir = path.resolve(__dirname, "dist");
    await rm(distDir, { recursive: true, force: true });

    console.log("building server...");

    await esbuild({
      entryPoints: [path.resolve(__dirname, "src/index.ts")],
      platform: "node",
      bundle: true,
      format: "cjs",
      outfile: path.resolve(distDir, "index.cjs"),
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      minify: true,
      packages: "external",
      alias: {
        "@workspace/api-zod": path.join(workspaceRoot, "lib/api-zod/src/index.ts"),
        "@workspace/db": path.join(workspaceRoot, "lib/db/src/index.ts"),
      },
      logLevel: "info",
    });
  }

  buildAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  