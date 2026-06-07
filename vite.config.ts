import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

const ignorePatterns = ["**/node_modules/**", "**/build/**", "**/.svelte-kit/**"];

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
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
      stylesheet: "src/public/styles/base.css",
    },
  },
  lint: {
    ignorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
