import adapter from "@sveltejs/adapter-bun";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type PluginOption } from "vite-plus";

const ignorePatterns = ["**/node_modules/**", "**/build/**", "**/.svelte-kit/**"];

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: true,
        modernAst: true,
        experimental: {
          async: true,
        },
      },
      experimental: {
        remoteFunctions: true,
      },
      // BUILD_EXE=1 compiles the server into a single executable (build/server) for the
      // host; BUILD_EXE=<bun target> (e.g. bun-linux-arm64) cross-compiles.
      // assets/bg is served from disk at runtime and is not embedded.
      adapter: adapter(
        process.env.BUILD_EXE
          ? {
              buildOptions: {
                compile:
                  process.env.BUILD_EXE === "1"
                    ? true
                    : (process.env.BUILD_EXE as Bun.Build.CompileTarget),
                minify: true,
              },
            }
          : { precompress: false },
      ),
    }),
  ] as PluginOption[],
  build: {
    target: ["safari26", "esnext"],
    cssMinify: "lightningcss",
  },
  css: {
    transformer: "lightningcss",
    lightningcss: {
      targets: { safari: 26 },
    },
  },
  fmt: {
    ignorePatterns,
    sortImports: {
      newlinesBetween: false,
      groups: [
        ["value-builtin", "value-external"],
        ["value-internal", "value-parent", "value-sibling", "value-index"],
        { newlinesBetween: true },
        "type-import",
        "unknown",
      ],
    },
    sortTailwindcss: {
      stylesheet: "src/app.css",
    },
  },
  lint: {
    ignorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    coverage: {
      reporter: ["text", "lcovonly"],
      include: ["src/**/*.{ts,svelte}"],
    },
  },
});
