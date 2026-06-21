/**
 * Benchmark KaTeX symbol table serialization formats.
 * Run from lib/: pnpm exec node --experimental-strip-types scripts/benchmark-bundle-formats.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  KATEX_ACCENTS,
  KATEX_FUNCTIONS,
  KATEX_INTEGRAL_OPS,
  KATEX_LIMITS_TEXT_OPS,
  KATEX_NARY_OPS,
  KATEX_SYMBOLS,
  type KatexNAryOp,
} from "../src/katexData.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const INDEX = join(SRC, "index.ts");
const KATEX_DATA = join(SRC, "katexData.ts");

type Format = {
  name: string;
  note: string;
  write: () => void;
  patchIndex: (src: string) => string;
};

const sortedEntries = Object.entries(KATEX_SYMBOLS).sort(([a], [b]) =>
  a.localeCompare(b),
);

const formatNAryOps = (ops: Record<string, KatexNAryOp>): string =>
  Object.entries(ops)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      const loc = v.limitLocationVal
        ? `, limitLocationVal: ${JSON.stringify(v.limitLocationVal)}`
        : "";
      return `  ${JSON.stringify(k)}: { accent: ${JSON.stringify(v.accent)}${loc} },`;
    })
    .join("\n");

const metaTail = [
  `export const KATEX_ACCENTS = ${JSON.stringify(KATEX_ACCENTS)} as Record<string, string>;`,
  ``,
  `export const KATEX_FUNCTIONS = new Set<string>(${JSON.stringify([...KATEX_FUNCTIONS].sort())});`,
  ``,
  `export type KatexNAryOp = { accent: string; limitLocationVal?: "subSup" };`,
  ``,
  `export const KATEX_NARY_OPS: Record<string, KatexNAryOp> = {`,
  formatNAryOps(KATEX_NARY_OPS),
  `};`,
  ``,
  `export const KATEX_INTEGRAL_OPS: Record<string, KatexNAryOp> = {`,
  formatNAryOps(KATEX_INTEGRAL_OPS),
  `};`,
  ``,
  `export const KATEX_LIMITS_TEXT_OPS = new Set<string>(${JSON.stringify([...KATEX_LIMITS_TEXT_OPS].sort())});`,
  ``,
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
  Buffer.from(JSON.stringify(KATEX_SYMBOLS), "utf8"),
).toString("base64");

const baselineIndex = readFileSync(INDEX, "utf8");
const baselineKatexData = readFileSync(KATEX_DATA, "utf8");

const mapPatchIndex = (src: string): string =>
  src
    .replace(
      `  KATEX_SYMBOLS,\n  type KatexNAryOp,\n} from "./katexData";`,
      `  type KatexNAryOp,\n  KATEX_SYMBOL_MAP,\n} from "./katexData";`,
    )
    .replace(
      `const resolveLatexSymbol = (name: string): string | undefined =>\n  KATEX_SYMBOLS[name];`,
      `const resolveLatexSymbol = (name: string): string | undefined =>\n  KATEX_SYMBOL_MAP.get(name);`,
    );

const formats: Format[] = [
  {
    name: "1-baseline-literal",
    note: "Current katexData.ts: merged object literal + direct lookup",
    write: () => writeFileSync(KATEX_DATA, baselineKatexData),
    patchIndex: (src) => src,
  },
  {
    name: "2-merged-literal",
    note: "Regenerated object literal from imported KATEX_SYMBOLS",
    write: () => {
      writeFileSync(
        KATEX_DATA,
        [
          `/** benchmark: merged object literal */`,
          `export const KATEX_SYMBOLS: Record<string, string> = {`,
          objectLiteralBody,
          `};`,
          ``,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: (src) => src,
  },
  {
    name: "3-json-parse",
    note: "Single JSON.parse blob",
    write: () => {
      writeFileSync(
        KATEX_DATA,
        [
          `/** benchmark: JSON.parse blob */`,
          `export const KATEX_SYMBOLS = JSON.parse(${JSON.stringify(JSON.stringify(KATEX_SYMBOLS))}) as Record<string, string>;`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: (src) => src,
  },
  {
    name: "4-tuple-fromEntries",
    note: "Tuple array + Object.fromEntries at module init",
    write: () => {
      writeFileSync(
        KATEX_DATA,
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
    patchIndex: (src) => src,
  },
  {
    name: "5-parallel-arrays",
    note: "Parallel keys/values arrays + Object.fromEntries",
    write: () => {
      writeFileSync(
        KATEX_DATA,
        [
          `/** benchmark: parallel arrays */`,
          `const KEYS = [${parallelKeys}] as const;`,
          `const VALS = ${parallelValues} as const;`,
          `export const KATEX_SYMBOLS = Object.fromEntries(KEYS.map((k, i) => [k, VALS[i]])) as Record<string, string>;`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: (src) => src,
  },
  {
    name: "6-gzip-base64-node",
    note: "gzip+base64 blob, gunzipSync at module init (Node zlib)",
    write: () => {
      writeFileSync(
        KATEX_DATA,
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
    patchIndex: (src) => src,
  },
  {
    name: "7-literal-oneline",
    note: "Merged object literal on one line via JSON.stringify",
    write: () => {
      writeFileSync(
        KATEX_DATA,
        [
          `/** benchmark: one-line object literal */`,
          `export const KATEX_SYMBOLS: Record<string, string> = ${JSON.stringify(KATEX_SYMBOLS)};`,
          metaTail,
        ].join("\n"),
      );
    },
    patchIndex: (src) => src,
  },
  {
    name: "8-map-constructor",
    note: "new Map(entries) then lookup via .get",
    write: () => {
      writeFileSync(
        KATEX_DATA,
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
    patchIndex: mapPatchIndex,
  },
];

const measure = () => {
  const cjs = readFileSync(join(ROOT, "dist/index.js"));
  const esm = readFileSync(join(ROOT, "dist/index.mjs"));
  const gzCjs = execSync("gzip -c dist/index.js", {
    cwd: ROOT,
    encoding: "buffer",
  });
  const dataSrc = readFileSync(KATEX_DATA).length;

  return { cjs: cjs.length, esm: esm.length, gzCjs: gzCjs.length, dataSrc };
};

console.log("KaTeX symbol format benchmark\n");
console.log(`Merged lookup entries: ${sortedEntries.length}`);
console.log(`Raw JSON size: ${JSON.stringify(KATEX_SYMBOLS).length} B`);
console.log(
  `gzip(JSON) alone: ${gzipSync(Buffer.from(JSON.stringify(KATEX_SYMBOLS))).length} B`,
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
writeFileSync(KATEX_DATA, baselineKatexData);

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
