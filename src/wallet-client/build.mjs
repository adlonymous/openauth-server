/**
 * Build script for the SIWS wallet client bundle
 *
 * Uses esbuild to create a browser-compatible IIFE bundle
 * that can be loaded via <script src="/wallet-client.js">
 *
 * Run: node src/wallet-client/build.mjs
 */

import * as esbuild from "esbuild"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, "../..")

async function build() {
  console.log("Building wallet client bundle...")

  try {
    const result = await esbuild.build({
      entryPoints: [join(__dirname, "index.ts")],
      bundle: true,
      minify: true,
      sourcemap: true,
      format: "iife",
      target: ["es2020"],
      outfile: join(rootDir, "public/wallet-client.js"),
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      // Generate metafile for bundle analysis
      metafile: true,
      // Handle Node.js built-ins that might be referenced
      platform: "browser",
      // Don't fail on warnings
      logLevel: "warning",
      // Tree shaking optimizations
      treeShaking: true,
      // Drop unused code
      drop: ["debugger"],
      // Ignore side effects for better tree shaking (careful with this)
      ignoreAnnotations: false,
    })

    // Report bundle size
    const outputs = result.metafile?.outputs || {}
    for (const [file, info] of Object.entries(outputs)) {
      if (file.endsWith(".js")) {
        const sizeKB = (info.bytes / 1024).toFixed(1)
        const sizeGzip = ((info.bytes * 0.3) / 1024).toFixed(1) // Rough gzip estimate
        console.log(`✓ Built ${file}`)
        console.log(`  Size: ${sizeKB} KB (estimated ~${sizeGzip} KB gzipped)`)
      }
    }

    console.log("\nBundle ready for use in browser!")
  } catch (error) {
    console.error("Build failed:", error)
    process.exit(1)
  }
}

build()
