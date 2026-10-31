import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter(),
      // GitHub Pages serves the site from /marathon_den_haag_tracker_2026; local builds use the root.
      paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}` },
      // Registered by the page, which waits for it to take control before loading the map.
      serviceWorker: { register: false },
    }),
  ],
});
