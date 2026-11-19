import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node26",
    outDir: "dist/sdk",
    emptyOutDir: true,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rollupOptions: {
      plugins: [
        {
          name: "check-sdk-dependency-notices",
          generateBundle(_options, bundle) {
            const paths = new Set<string>();
            for (const output of Object.values(bundle)) {
              if (output.type !== "chunk") continue;
              if (output.imports.length || output.dynamicImports.length) {
                this.error(
                  "The standalone SDK bundle must have no runtime imports.",
                );
              }
              for (const id of output.moduleIds) {
                const dependency = [
                  ...id.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g),
                ].at(-1)?.[1];
                if (dependency) paths.add(dependency);
              }
            }
            if ([...paths].sort().join(",") !== "entities,parse5") {
              this.error(
                `Review SDK notices for bundled packages: ${[...paths].sort().join(", ")}`,
              );
            }
          },
        },
      ],
    },
  },
});
