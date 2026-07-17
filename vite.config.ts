import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

const ignorePatterns = ["**/node_modules/**", "**/build/**", "**/.svelte-kit/**"];

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    // Latest WebKit (Safari 18+) supports virtually all ES2024 + ESNext features.
    target: ["safari18", "esnext"],
    cssMinify: "lightningcss",
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
      provider: "istanbul",
      reporter: ["text", "lcovonly"],
      include: ["src/**/*.{ts,svelte}"],
    },
  },
});
