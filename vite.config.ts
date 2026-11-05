import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 5173 },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "editor",
              test: /node_modules[\\/](?:@tiptap|prosemirror-|marked|lowlight)/,
              priority: 30,
            },
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "markdown",
              test: /node_modules[\\/](?:markdown-it|markdown-it-container|linkify-it|mdurl|uc\.micro|entities|punycode)/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
