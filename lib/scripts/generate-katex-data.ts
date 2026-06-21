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
const overrideMap: Record<string, string> = {};

type KatexNAryOp = { accent: string; limitLocationVal?: "subSup" };

/** Commands excluded from generated operator tables (with reason). */
const EXCLUDED_OPS: Record<string, string> = {
  mathop: "takes a body argument, not a standalone operator name",
};

/** Parse a defineFunction block from op.js for limits/symbol flags and names. */
const parseOpBlock = (
  block: string,
): { limits: boolean; symbol: boolean; names: string[] } | undefined => {
  if (!block.includes('type: "op"')) return undefined;
  const limitsMatch = block.match(/limits:\s*(true|false)/);
  const symbolMatch = block.match(/symbol:\s*(true|false)/);
  if (!limitsMatch || !symbolMatch) return undefined;

  const namesMatch = block.match(/names:\s*\[([\s\S]*?)\]/);
  const names: string[] = [];
  if (namesMatch) {
    for (const nameMatch of namesMatch[1].matchAll(/"\\\\([^"]+)"/g)) {
      names.push(nameMatch[1]);
    }
  }
  return {
    limits: limitsMatch[1] === "true",
    symbol: symbolMatch[1] === "true",
    names,
  };
};

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

  const lookupMap: Record<string, string> = {
    ...aliasMap,
    ...symbolMap,
    ...overrideMap,
  };

  const fnSet = new Set<string>();
  const limitsTextSet = new Set<string>();
  const naryOps: Record<string, KatexNAryOp> = {};
  const integralOps: Record<string, KatexNAryOp> = {};
  const excluded: Record<string, string> = { ...EXCLUDED_OPS };

  /** Resolve a command name to its n-ary accent character via lookupMap. */
  const resolveAccent = (cmd: string): string | undefined => lookupMap[cmd];

  let blockIdx = 0;
  let nextBlockIdx = opSrc.indexOf("defineFunction({", blockIdx);
  while (nextBlockIdx !== -1) {
    blockIdx = nextBlockIdx;
    const blockEnd = opSrc.indexOf("});", blockIdx);
    const block = opSrc.slice(blockIdx, blockEnd);
    const parsed = parseOpBlock(block);
    if (parsed) {
      const { limits, symbol, names } = parsed;
      for (const name of names) {
        if (EXCLUDED_OPS[name]) continue;

        if (limits && symbol) {
          const accent = resolveAccent(name);
          if (accent) {
            naryOps[name] = { accent };
          } else {
            excluded[name] = "no resolvable accent in KATEX_SYMBOLS";
          }
        } else if (!limits && symbol) {
          const accent = resolveAccent(name);
          if (accent) {
            integralOps[name] = { accent, limitLocationVal: "subSup" };
          } else {
            excluded[name] = "no resolvable accent in KATEX_SYMBOLS";
          }
        } else if (limits && !symbol) {
          limitsTextSet.add(name);
        } else {
          fnSet.add(name);
        }
      }
    }
    blockIdx = blockEnd;
    nextBlockIdx = opSrc.indexOf("defineFunction({", blockIdx);
  }

  for (const m of macrosSrc.matchAll(/defineMacro\("\\\\(liminf|limsup)",/g)) {
    limitsTextSet.add(m[1]);
  }

  for (const name of limitsTextSet) {
    fnSet.delete(name);
  }
  for (const name of Object.keys(naryOps)) {
    fnSet.delete(name);
  }
  for (const name of Object.keys(integralOps)) {
    fnSet.delete(name);
  }
  fnSet.delete("mathop");

  const lookupLines = Object.entries(lookupMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");

  const sourceNote = `KaTeX v${KATEX_VERSION} — regenerate via \`${REGENERATE_CMD}\` (fetches from ${KATEX_BASE}).`;
  const functions = [...fnSet].sort();
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

  writeFileSync(
    join(ROOT, "src/katexData.ts"),
    [
      `/** ${sourceNote} */`,
      `export const KATEX_SYMBOLS: Record<string, string> = {`,
      lookupLines,
      `};`,
      ``,
      `export const KATEX_ACCENTS = ${JSON.stringify(accentMap)} as Record<string, string>;`,
      ``,
      `export const KATEX_FUNCTIONS = new Set<string>(${JSON.stringify(functions)});`,
      ``,
      `export type KatexNAryOp = { accent: string; limitLocationVal?: "subSup" };`,
      ``,
      `export const KATEX_NARY_OPS: Record<string, KatexNAryOp> = {`,
      formatNAryOps(naryOps),
      `};`,
      ``,
      `export const KATEX_INTEGRAL_OPS: Record<string, KatexNAryOp> = {`,
      formatNAryOps(integralOps),
      `};`,
      ``,
      `export const KATEX_LIMITS_TEXT_OPS = new Set<string>(${JSON.stringify([...limitsTextSet].sort())});`,
      ``,
    ].join("\n"),
  );

  console.log(`KATEX_SYMBOLS: ${Object.keys(lookupMap).length} (merged)`);
  console.log(`  base symbols: ${Object.keys(symbolMap).length}`);
  console.log(`  aliases: ${Object.keys(aliasMap).length}`);
  console.log(`  overrides: ${Object.keys(overrideMap).length}`);
  console.log(`KATEX_ACCENTS: ${Object.keys(accentMap).length}`);
  console.log(`KATEX_FUNCTIONS: ${fnSet.size}`);
  console.log(`KATEX_NARY_OPS: ${Object.keys(naryOps).length}`);
  console.log(`KATEX_INTEGRAL_OPS: ${Object.keys(integralOps).length}`);
  console.log(`KATEX_LIMITS_TEXT_OPS: ${limitsTextSet.size}`);
  if (Object.keys(excluded).length > 0) {
    console.log("Excluded ops:");
    for (const [cmd, reason] of Object.entries(excluded).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      console.log(`  ${cmd}: ${reason}`);
    }
  }
};

generate().catch((error) => {
  console.error(error);
  throw error;
});
