import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/subscriber.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  external: ["@solana/web3.js"],
});
