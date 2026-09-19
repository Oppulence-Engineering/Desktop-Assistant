import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    "../stories/**/*.stories.@(ts|tsx)",
    "../components/**/*.stories.@(ts|tsx)",
    "../app/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-essentials"],
  framework: "@storybook/react-vite",
  async viteFinal(config) {
    return mergeConfig(config, {
      css: {
        postcss: {
          plugins: [(await import("@tailwindcss/postcss")).default],
        },
      },
      resolve: {
        alias: {
          "@": path.resolve(dirname, ".."),
        },
      },
    });
  },
};

export default config;
