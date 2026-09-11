/**
 * Fails the build when the server bundles import a package that the production image won't have.
 * The runtime stage installs `dependencies` only, so an import of a devDependency works in
 * development and in every test, then breaks the published image — which is how qrcode broke
 * v0.1.0–v0.2.0. Scans build/server and build/admin for bare import specifiers.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
const builtins = new Set(builtinModules);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") ? [path] : [];
  });
}

// Import statements as bundlers emit them (at the start of a line), and dynamic import() of a
// string literal. Anchored so that text such as `from "admin"` inside a string isn't mistaken
// for an import.
const patterns = [
  /^\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"'./][^"']*)["']/gm,
  /^\s*import\s*["']([^"'./][^"']*)["']/gm,
  /\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/g,
];
const problems = [];
for (const dir of ["build/server", "build/admin"]) {
  for (const file of files(dir)) {
    const source = readFileSync(file, "utf8");
    for (const [, spec] of patterns.flatMap((pattern) => [...source.matchAll(pattern)])) {
      if (spec.startsWith("node:") || builtins.has(spec.split("/")[0])) continue;
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!runtime.has(name)) problems.push(`${file}: imports "${spec}", but ${name} is not in dependencies`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Runtime dependency check failed:\n${[...new Set(problems)].join("\n")}`);
  process.exit(1);
}
console.log("Runtime dependency check passed");
