import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
    plugins: [react()],
    base: "./",
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    build: {
        chunkSizeWarningLimit: 1200,
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ["react", "react-dom", "react-router-dom"],
                },
            },
        },
    },
    server: {
        port: 5174,
        proxy: {
            "/api": "http://localhost:47200",
        },
    },
});
