import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/") ||
            id.includes("/node_modules/@tanstack/") ||
            id.includes("/node_modules/use-sync-external-store/")
          ) {
            return "vendor-react";
          }
          if (
            id.includes("/node_modules/antd/es/upload/") ||
            id.includes("/node_modules/rc-upload/")
          ) {
            return "vendor-upload";
          }
          if (
            id.includes("/node_modules/rc-") ||
            id.includes("/node_modules/@rc-component/") ||
            id.includes("/node_modules/@ant-design/cssinjs/") ||
            id.includes("/node_modules/@ant-design/cssinjs-utils/") ||
            id.includes("/node_modules/@ant-design/fast-color/") ||
            id.includes("/node_modules/@ant-design/colors/") ||
            id.includes("/node_modules/@ant-design/react-slick/")
          ) {
            return "vendor-rc";
          }
          if (
            id.includes("/node_modules/@ant-design/icons/") ||
            id.includes("/node_modules/@ant-design/icons-svg/")
          ) {
            return "vendor-antd-icons";
          }
          if (id.includes("/node_modules/antd/")) {
            return "vendor-antd";
          }
          if (id.includes("/node_modules/lucide-react/")) {
            return "vendor-icons";
          }
          return "vendor-utils";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/qdrant": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/qdrant/, "/api"),
      },
      "/api/solr": {
        target: "http://127.0.0.1:8010",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/solr/, "/api"),
      },
      "/api/elasticsearch": {
        target: "http://127.0.0.1:8020",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/elasticsearch/, "/api"),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },
});
