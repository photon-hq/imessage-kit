import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    target: 'es2022',
    outDir: 'dist',
    platform: 'node',
    splitting: false,
    bundle: true,
    // External dependencies - will be resolved at runtime
    external: [
        'bun:sqlite', // Bun runtime
        'better-sqlite3', // Node.js runtime
    ],
})
