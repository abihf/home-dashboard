import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	build: {
		target: "esnext",
	},
	plugins: [tailwindcss(), sveltekit()],
	test: {
		include: ["src/**/*.{test,spec}.{js,ts}"],
	},
});
