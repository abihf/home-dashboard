import adapter from "@eslym/sveltekit-adapter-bun";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    runes: true,
  },
  kit: {
    adapter: adapter({ precompress: false, bundler: "bun", bunBuildMinify: true }),
  },
};

export default config;
