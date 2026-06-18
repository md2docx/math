/**
 * Generates KaTeX-derived symbol data for @m2d/math.
 * Fetches KaTeX v0.16.22 source at codegen time (MIT):
 *   https://github.com/KaTeX/KaTeX/tree/v0.16.22/src
 *
 * Run: pnpm generate:katex
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KATEX_VERSION = "0.16.22";
const KATEX_BASE = `https://raw.githubusercontent.com/KaTeX/KaTeX/v${KATEX_VERSION}/src`;
const REGENERATE_CMD = "pnpm generate:katex";
const SIMPLE_MACRO = /^\\([a-zA-Z@][a-zA-Z0-9@]*)$/;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

/** Fetch a KaTeX source file from the pinned GitHub release. */
const fetchKatexSource = async (path: string): Promise<string> => {
  const url = `${KATEX_BASE}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
};

const symbolMap: Record<string, string> = {};
const aliasMap: Record<string, string> = {};
const accentMap: Record<string, string> = {};
const fnSet = new Set<string>();
const overrideMap: Record<string, string> = {};

/** Decode a KaTeX char literal or single-character string. */
const decodeChar = (raw: string): string | undefined => {
  if (/^\\u[0-9a-fA-F]{4}$/.test(raw)) {
    return JSON.parse(`"${raw}"`) as string;
  }
  return raw.length === 1 ? raw : undefined;
};

// skipcq: JS-R1005
/** Generate KaTeX symbol tables and write them to src/. */
const generate = async (): Promise<void> => {
  console.log(`Fetching KaTeX v${KATEX_VERSION} from ${KATEX_BASE}`);

  const [symbolsSrc, macrosSrc, opSrc] = await Promise.all([
    fetchKatexSource("symbols.js"),
    fetchKatexSource("macros.js"),
    fetchKatexSource("functions/op.js"),
  ]);

  for (const m of symbolsSrc.matchAll(/defineSymbol\([^\n]+\)/g)) {
    const strMatch = [
      ...m[0].matchAll(/"((?:\\u[0-9a-fA-F]{4}|\\[^"]|[^"])+)"/g),
    ];
    if (strMatch.length < 2) continue;
    const unicode = JSON.parse(`"${strMatch[0][1]}"`) as string;
    const cmd = strMatch[1][1].replace(/^\\+/, "");
    symbolMap[cmd] = unicode;
  }

  /** Resolve a macro name to a single Unicode character, following aliases. */
  const resolveToUnicode = (
    name: string,
    seen = new Set<string>(),
  ): string | undefined => {
    if (seen.has(name)) return undefined;
    seen.add(name);
    if (symbolMap[name]) return symbolMap[name];
    const bodyMatch = macrosSrc.match(
      new RegExp(
        `defineMacro\\("\\\\\\\\${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*"([^"]+)"\\)`,
      ),
    );
    if (!bodyMatch) return undefined;
    const body = bodyMatch[1];
    if (body.startsWith("\\mathrm{") && body.endsWith("}")) {
      return body.slice(9, -1);
    }
    if (body.length === 1 && !body.startsWith("\\")) {
      return body;
    }
    const charMatch = body.match(/\\char[`'"]((?:\\u[0-9a-fA-F]{4}|[^`'"]+))/);
    if (charMatch) {
      return decodeChar(charMatch[1]);
    }
    if (body.startsWith("\\") && !body.includes("{")) {
      return resolveToUnicode(body.replace(/^\\+/, ""), seen);
    }
    return undefined;
  };

  for (const m of macrosSrc.matchAll(
    /defineMacro\("\\\\([^"]+)",\s*"([^"]+)"\)/g,
  )) {
    const name = m[1];
    if (!/^[a-zA-Z@][a-zA-Z0-9@]*$/.test(name)) continue;
    const resolved = resolveToUnicode(name);
    if (resolved && [...resolved].length === 1) {
      aliasMap[name] = resolved;
    }
  }

  for (const m of symbolsSrc.matchAll(/defineSymbol\([^\n]+\)/g)) {
    if (!m[0].includes(", accent,")) continue;
    const strMatch = [
      ...m[0].matchAll(/"((?:\\u[0-9a-fA-F]{4}|\\[^"]|[^"])+)"/g),
    ];
    if (strMatch.length < 2) continue;
    const chr = JSON.parse(`"${strMatch[0][1]}"`) as string;
    const cmd = strMatch[1][1].replace(/^\\+/, "");
    accentMap[cmd] = chr;
  }

  let blockIdx = 0;
  let nextBlockIdx = opSrc.indexOf("defineFunction({", blockIdx);
  while (nextBlockIdx !== -1) {
    blockIdx = nextBlockIdx;
    const blockEnd = opSrc.indexOf("});", blockIdx);
    const block = opSrc.slice(blockIdx, blockEnd);
    if (block.includes("symbol: false") && !block.includes("symbol: true")) {
      const namesMatch = block.match(/names:\s*\[([\s\S]*?)\]/);
      if (namesMatch) {
        for (const nameMatch of namesMatch[1].matchAll(/"\\+([^"]+)"/g)) {
          fnSet.add(nameMatch[1]);
        }
      }
    }
    blockIdx = blockEnd;
    nextBlockIdx = opSrc.indexOf("defineFunction({", blockIdx);
  }
  for (const m of macrosSrc.matchAll(/defineMacro\("\\\\(liminf|limsup)",/g)) {
    fnSet.add(m[1]);
  }

  for (const m of macrosSrc.matchAll(
    /defineMacro\("\\\\([^"]+)",\s*"\\html@mathml\{[^}]+\}\{[^}]*\\char[`'"]((?:\\u[0-9a-fA-F]{4}|[^`'"]+))/g,
  )) {
    const resolved = decodeChar(m[2]);
    if (resolved && [...resolved].length === 1) {
      overrideMap[m[1]] = resolved;
    }
  }
  for (const m of macrosSrc.matchAll(
    /defineMacro\("\\\\(q?quad)",\s*"\\\\hskip(\d+)em/g,
  )) {
    overrideMap[m[1]] = m[1] === "qquad" ? "\u2003\u2003" : "\u2003";
  }
  for (const m of macrosSrc.matchAll(
    /defineMacro\("(\\u[0-9a-fA-F]{4})",\s*"\\\\([^"]+)"\)/g,
  )) {
    const unicode = JSON.parse(`"${m[1]}"`) as string;
    const target = `\\${m[2]}`;
    if (!SIMPLE_MACRO.test(target) || unicode === "\uFE0F") continue;
    const cmd = m[2];
    const resolved = resolveToUnicode(cmd) ?? unicode;
    if ([...resolved].length === 1) {
      overrideMap[cmd] = resolved;
    }
  }
  for (const m of macrosSrc.matchAll(
    /defineMacro\("\\\\([^"]+)",\s*"([^"]+)"\)/g,
  )) {
    const name = m[1];
    if (!/^[a-zA-Z@][a-zA-Z0-9@]*$/.test(name)) continue;
    if (symbolMap[name] || aliasMap[name] || overrideMap[name]) continue;
    const resolved = resolveToUnicode(name);
    if (resolved && [...resolved].length === 1) {
      overrideMap[name] = resolved;
    }
  }

  if (overrideMap.neq) overrideMap.ne = overrideMap.neq;
  if (symbolMap["@cdots"]) overrideMap.cdots = symbolMap["@cdots"];

  const symbolLines = Object.entries(symbolMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");

  const sourceNote = `KaTeX v${KATEX_VERSION} — regenerate via \`${REGENERATE_CMD}\` (fetches from ${KATEX_BASE}).`;

  writeFileSync(
    join(ROOT, "src/katexSymbols.ts"),
    `/** ${sourceNote} */\nexport const KATEX_SYMBOLS: Record<string, string> = {\n${symbolLines}\n};\n`,
  );

  writeFileSync(
    join(ROOT, "src/katexMeta.ts"),
    `/** ${sourceNote} */\nexport const KATEX_ALIASES: Record<string, string> = ${JSON.stringify(aliasMap, null, 2)};\n\nexport const KATEX_ACCENTS: Record<string, string> = ${JSON.stringify(accentMap, null, 2)};\n\nexport const KATEX_FUNCTIONS = new Set<string>(${JSON.stringify([...fnSet].sort())});\n\n/** KaTeX macro-only symbols mapped to Unicode for Word OMML text runs. */\nexport const KATEX_SYMBOL_OVERRIDES: Record<string, string> = ${JSON.stringify(overrideMap, null, 2)};\n`,
  );

  console.log(`KATEX_SYMBOLS: ${Object.keys(symbolMap).length}`);
  console.log(`KATEX_ALIASES: ${Object.keys(aliasMap).length}`);
  console.log(`KATEX_FUNCTIONS: ${fnSet.size}`);
  console.log(`KATEX_SYMBOL_OVERRIDES: ${Object.keys(overrideMap).length}`);
};

generate().catch((error) => {
  console.error(error);
  throw error;
});
