import adapter from "@risk-tolerance/svelte-adapter-bun";
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
        experimental: {
          async: true,
        },
      },
      experimental: {
        remoteFunctions: true,
      },
      adapter: adapter({ precompress: false, bundler: "bun" }),
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
