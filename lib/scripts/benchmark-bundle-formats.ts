/**
 * Benchmark KaTeX symbol table serialization formats.
 * Run from lib/: pnpm exec node --experimental-strip-types scripts/benchmark-bundle-formats.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  KATEX_ACCENTS,
  KATEX_ALIASES,
  KATEX_FUNCTIONS,
  KATEX_SYMBOL_OVERRIDES,
} from "../src/katexMeta.ts";
import { KATEX_SYMBOLS as BASE_SYMBOLS } from "../src/katexSymbols.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const INDEX = join(SRC, "index.ts");

type Format = {
  name: string;
  note: string;
  write: () => void;
  patchIndex: (src: string) => string;
};

const mergedLookup: Record<string, string> = {
  ...KATEX_ALIASES,
  ...BASE_SYMBOLS,
  ...KATEX_SYMBOL_OVERRIDES,
};

const sortedEntries = Object.entries(mergedLookup).sort(([a], [b]) =>
  a.localeCompare(b),
);
const accentsJson = JSON.stringify(KATEX_ACCENTS);
const functionsJson = JSON.stringify([...KATEX_FUNCTIONS].sort());

const metaTail = [
  `export const KATEX_ACCENTS = ${accentsJson} as Record<string, string>;`,
  `export const KATEX_FUNCTIONS = new Set<string>(${functionsJson});`,
  "",
].join("\n");

const objectLiteralBody = sortedEntries
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join("\n");

const tupleBody = sortedEntries
  .map(([k, v]) => `  [${JSON.stringify(k)}, ${JSON.stringify(v)}],`)
  .join("\n");

const parallelKeys = sortedEntries.map(([k]) => JSON.stringify(k)).join(",");
const parallelValues = JSON.stringify(sortedEntries.map(([, v]) => v));
const gzipB64 = gzipSync(
  Buffer.from(JSON.stringify(mergedLookup), "utf8"),
).toString("base64");

const baselineIndex = readFileSync(INDEX, "utf8");

const cleanupGenerated = () => {
  for (const f of ["katexData.ts"]) {
    try {
      rmSync(join(SRC, f));
    } catch {
      /* absent */
    }
  }
};

const mergedPatchIndex = (src: string): string =>
  src
    .replace(
      `import { KATEX_ACCENTS, KATEX_ALIASES, KATEX_FUNCTIONS, KATEX_SYMBOL_OVERRIDES } from "./katexMeta";\nimport { KATEX_SYMBOLS } from "./katexSymbols";`,
      `import { KATEX_ACCENTS, KATEX_FUNCTIONS, KATEX_SYMBOLS } from "./katexData";`,
    )
    .replace(
      `const resolveLatexSymbol = (name: string): string | undefined =>\n  KATEX_SYMBOL_OVERRIDES[name] ?? KATEX_SYMBOLS[name] ?? KATEX_ALIASES[name];`,
      `const resolveLatexSymbol = (name: string): string | undefined => KATEX_SYMBOLS[name];`,
    );

const formats: Format[] = [
  {
    name: "1-baseline-multi",
    note: "PR #7: katexSymbols + katexMeta, 3-table lookup chain",
    write: () => cleanupGenerated(),
    patchIndex: (src) => src,
  },
  {
    name: "2-merged-literal",
    note: "Single katexData.ts object literal + direct lookup",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: merged object literal */`,
          `export const KATEX_SYMBOLS: Record<string, string> = {`,
          objectLiteralBody,
          `};`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: mergedPatchIndex,
  },
  {
    name: "3-json-parse",
    note: "Single JSON.parse blob",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: JSON.parse blob */`,
          `export const KATEX_SYMBOLS = JSON.parse(${JSON.stringify(JSON.stringify(mergedLookup))}) as Record<string, string>;`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: mergedPatchIndex,
  },
  {
    name: "4-tuple-fromEntries",
    note: "Tuple array + Object.fromEntries at module init",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: tuple entries + Object.fromEntries */`,
          `const ENTRIES: [string, string][] = [`,
          tupleBody,
          `];`,
          `export const KATEX_SYMBOLS = Object.fromEntries(ENTRIES) as Record<string, string>;`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: mergedPatchIndex,
  },
  {
    name: "5-parallel-arrays",
    note: "Parallel keys/values arrays + Object.fromEntries",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: parallel arrays */`,
          `const KEYS = [${parallelKeys}] as const;`,
          `const VALS = ${parallelValues} as const;`,
          `export const KATEX_SYMBOLS = Object.fromEntries(KEYS.map((k, i) => [k, VALS[i]])) as Record<string, string>;`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: mergedPatchIndex,
  },
  {
    name: "6-gzip-base64-node",
    note: "gzip+base64 blob, gunzipSync at module init (Node zlib)",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: gzip base64 (Node) */`,
          `import { gunzipSync } from "node:zlib";`,
          `const B64 = ${JSON.stringify(gzipB64)};`,
          `export const KATEX_SYMBOLS = JSON.parse(`,
          `  gunzipSync(Buffer.from(B64, "base64")).toString("utf8"),`,
          `) as Record<string, string>;`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: mergedPatchIndex,
  },
  {
    name: "7-literal-oneline",
    note: "Merged object literal on one line via JSON.stringify",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: one-line object literal */`,
          `export const KATEX_SYMBOLS: Record<string, string> = ${JSON.stringify(mergedLookup)};`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: mergedPatchIndex,
  },
  {
    name: "8-map-constructor",
    note: "new Map(entries) then lookup via .get",
    write: () => {
      cleanupGenerated();
      writeFileSync(
        join(SRC, "katexData.ts"),
        [
          `/** benchmark: Map constructor */`,
          `const ENTRIES: [string, string][] = [`,
          tupleBody,
          `];`,
          `export const KATEX_SYMBOL_MAP = new Map<string, string>(ENTRIES);`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: (src) =>
      mergedPatchIndex(src)
        .replace(
          `import { KATEX_ACCENTS, KATEX_FUNCTIONS, KATEX_SYMBOLS } from "./katexData";`,
          `import { KATEX_ACCENTS, KATEX_FUNCTIONS, KATEX_SYMBOL_MAP } from "./katexData";`,
        )
        .replace(`KATEX_SYMBOLS[name]`, `KATEX_SYMBOL_MAP.get(name)`),
  },
];

const measure = () => {
  const cjs = readFileSync(join(ROOT, "dist/index.js"));
  const esm = readFileSync(join(ROOT, "dist/index.mjs"));
  const gzCjs = execSync("gzip -c dist/index.js", {
    cwd: ROOT,
    encoding: "buffer",
  });
  const dataSrc = ["katexData.ts", "katexSymbols.ts", "katexMeta.ts"]
    .map((f) => join(SRC, f))
    .filter((f) => {
      try {
        readFileSync(f);
        return true;
      } catch {
        return false;
      }
    })
    .reduce((sum, f) => sum + readFileSync(f).length, 0);

  return { cjs: cjs.length, esm: esm.length, gzCjs: gzCjs.length, dataSrc };
};

console.log("KaTeX symbol format benchmark\n");
console.log(`Merged lookup entries: ${sortedEntries.length}`);
console.log(`Raw JSON size: ${JSON.stringify(mergedLookup).length} B`);
console.log(
  `gzip(JSON) alone: ${gzipSync(Buffer.from(JSON.stringify(mergedLookup))).length} B`,
);
console.log(`gzip+base64 payload: ${gzipB64.length} chars\n`);

const results: Array<
  { name: string; note: string } & ReturnType<typeof measure>
> = [];

for (const format of formats) {
  format.write();
  writeFileSync(INDEX, format.patchIndex(baselineIndex));
  execSync("pnpm build", { cwd: ROOT, stdio: "pipe" });
  const stats = measure();
  results.push({ name: format.name, note: format.note, ...stats });
  console.log(
    `✓ ${format.name}: gzip ${stats.gzCjs} B, CJS ${stats.cjs} B, data src ${stats.dataSrc} B`,
  );
}

writeFileSync(INDEX, baselineIndex);
cleanupGenerated();

console.log("\n| Format | gzip CJS | CJS | ESM | data src | vs baseline |");
console.log("|--------|----------|-----|-----|----------|-------------|");
const baseGz = results[0].gzCjs;
for (const r of results) {
  const delta = r.gzCjs - baseGz;
  const pct = ((delta / baseGz) * 100).toFixed(1);
  const deltaStr =
    delta === 0 ? "—" : `${delta >= 0 ? "+" : ""}${delta} B (${pct}%)`;
  console.log(
    `| ${r.name} | ${r.gzCjs} | ${r.cjs} | ${r.esm} | ${r.dataSrc} | ${deltaStr} |`,
  );
}

console.log("\nNotes:");
for (const r of results) {
  console.log(`- ${r.name}: ${r.note}`);
}
