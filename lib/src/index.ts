import type { EmptyNode, IPlugin } from "@m2d/core";
// skipcq: JS-C1003
import type * as latex from "@unified-latex/unified-latex-types";
// skipcq: JS-C1003
import type * as DOCX from "docx";
import { parseMath } from "latex-math";
import {
  KATEX_ACCENTS,
  KATEX_FUNCTIONS,
  KATEX_INTEGRAL_OPS,
  KATEX_LIMITS_TEXT_OPS,
  KATEX_NARY_OPS,
  KATEX_SYMBOLS,
  type KatexNAryOp,
} from "./katexData";

type DocxApi = typeof DOCX;

/**
 * Checks if the argument has curly brackets.
 */
const hasCurlyBrackets = (
  arg: latex.Argument | undefined,
): arg is latex.Argument =>
  Boolean(arg && arg.openMark === "{" && arg.closeMark === "}");

/** Pending n-ary operator awaiting limits and/or integrand body. */
type PendingNAry = {
  kind: "nary";
  accent: string;
  limitLocationVal?: string;
  sub: DOCX.MathRun[];
  sup: DOCX.MathRun[];
  body: MathComponent[];
};

/** Pending accent awaiting its base token. */
type PendingAccent = {
  kind: "accent";
  accentChar: string;
};

/** Pending limits-text operator awaiting a lower limit via subscript. */
type PendingLimitsTextOp = {
  kind: "limitsText";
  name: string;
};

/** Partial script node for chained sub/superscript attachment. */
type PendingScript =
  | {
      kind: "script";
      variant: "sub";
      base: DOCX.MathRun;
      sub: DOCX.MathRun[];
    }
  | {
      kind: "script";
      variant: "sup";
      base: DOCX.MathRun;
      sup: DOCX.MathRun[];
    }
  | {
      kind: "script";
      variant: "both";
      base: DOCX.MathRun;
      sub: DOCX.MathRun[];
      sup: DOCX.MathRun[];
    };

type PendingMarker =
  | PendingNAry
  | PendingAccent
  | PendingLimitsTextOp
  | PendingScript;

type BinomState =
  | { phase: "idle" }
  | { phase: "needFirst" }
  | { phase: "needSecond"; numerator: DOCX.MathRun[] };

/** Internal mapping state: OMML runs plus binomial context. */
type MapContext = {
  runs: MathComponent[];
  binom: BinomState;
};

type MathComponent = DOCX.MathRun | PendingMarker;

type MapNodeResult =
  | { type: "continue"; components: MathComponent[] }
  | { type: "break" };

type NAryBuild = {
  accent: string;
  limitLocationVal?: string;
  children: DOCX.MathRun[];
  subScript: DOCX.MathRun[];
  superScript: DOCX.MathRun[];
};

/** Cast custom OMML XmlComponents to MathRun for docx library interop. */
const asMathRun = (component: DOCX.XmlComponent): DOCX.MathRun =>
  component as unknown as DOCX.MathRun;

/** Build an OMML math run with plain text content. */
const makeMathRun = (docx: DocxApi, text: string): DOCX.MathRun =>
  new docx.MathRun(text);

const PLUGIN_ID = "@m2d/math";

/** Log and skip inline/block math that would emit empty OMML. */
const logSkippedEmptyMath = (latex: string, scope: "inline" | "block") => {
  console.error(
    `[${PLUGIN_ID}] Skipping empty ${scope} math for ${JSON.stringify(latex)}; no renderable OMML was produced. Empty <m:oMath> elements break Microsoft Word.`,
  );
};

/** Resolve a LaTeX command name to its Unicode symbol. */
const resolveLatexSymbol = (name: string): string | undefined =>
  KATEX_SYMBOLS[name];

const isMathRun = (node: MathComponent): node is DOCX.MathRun =>
  !("kind" in node);

const isPendingNAry = (node: MathComponent | undefined): node is PendingNAry =>
  Boolean(node && "kind" in node && node.kind === "nary");

const isPendingAccent = (
  node: MathComponent | undefined,
): node is PendingAccent =>
  Boolean(node && "kind" in node && node.kind === "accent");

const isPendingLimitsTextOp = (
  node: MathComponent | undefined,
): node is PendingLimitsTextOp =>
  Boolean(node && "kind" in node && node.kind === "limitsText");

const isPendingScript = (
  node: MathComponent | undefined,
): node is PendingScript =>
  Boolean(node && "kind" in node && node.kind === "script");

/** OMML accent chars must be combining marks (U+0300–U+036F, U+20D0–U+20EF). */
const OMML_ACCENT_CHARS: Record<string, string> = {
  hat: "\u0302",
  widehat: "\u0302",
  tilde: "\u0303",
  widetilde: "\u0303",
  bar: "\u0304",
  overline: "\u0305",
  dot: "\u0307",
  ddot: "\u0308",
  vec: "\u20D7",
  acute: "\u0301",
  grave: "\u0300",
  breve: "\u0306",
  check: "\u030C",
  mathring: "\u030A",
};

/** Map KaTeX accent glyphs to OMML combining marks. */
const KATEX_GLYPH_TO_OMML: Record<string, string> = {
  ˆ: "\u0302",
  "^": "\u0302",
  "˜": "\u0303",
  "~": "\u0303",
  ˉ: "\u0304",
  "¯": "\u0305",
  "˙": "\u0307",
  "¨": "\u0308",
  ˊ: "\u0301",
  ˋ: "\u0300",
  "⃗": "\u20D7",
  "˘": "\u0306",
  ˇ: "\u030C",
  "˚": "\u030A",
};

/** Resolve accent character for a LaTeX accent command name. */
const resolveAccentChar = (name: string): string | undefined => {
  const omml = OMML_ACCENT_CHARS[name];
  if (omml) return omml;
  const katexGlyph = KATEX_ACCENTS[name];
  if (katexGlyph) return KATEX_GLYPH_TO_OMML[katexGlyph];
  return undefined;
};

const resolveNAryOp = (name: string): KatexNAryOp | undefined =>
  KATEX_INTEGRAL_OPS[name] ?? KATEX_NARY_OPS[name];

/** True when a macro name maps to an OMML accent combining mark. */
const isAccentCommand = (name: string): boolean =>
  resolveAccentChar(name) !== undefined;

/** String nodes may contain unparsed scripts when nested inside braced groups. */
const UNPARSED_MATH_IN_STRING = /[\^_]|\\[a-zA-Z]/;

const mapStringNode = (docx: DocxApi, content: string): DOCX.MathRun[] =>
  UNPARSED_MATH_IN_STRING.test(content)
    ? mapGroup(docx, parseMath(content))
    : [makeMathRun(docx, content)];

/** Build an OMML n-ary operator element. */
const buildNAry = (docx: DocxApi, options: NAryBuild): DOCX.MathRun => {
  class MathNAry extends docx.XmlComponent {
    constructor() {
      super("m:nary");
      // OOXML requires m:sub, m:sup, and m:e in fixed order; all three must
      // always be present. Always report both limits so docx does not emit
      // subHide/supHide (which it orders incorrectly in naryPr).
      this.root.push(
        docx.createMathNAryProperties({
          accent: options.accent,
          hasSuperScript: true,
          hasSubScript: true,
          limitLocationVal: options.limitLocationVal,
        }),
      );
      this.root.push(
        docx.createMathSubScriptElement({
          children: options.subScript,
        }),
      );
      this.root.push(
        docx.createMathSuperScriptElement({
          children: options.superScript,
        }),
      );
      this.root.push(docx.createMathBase({ children: options.children }));
    }
  }
  return asMathRun(new MathNAry());
};

/** Build an OMML accent element (m:acc) wrapping base content. */
const buildMathAccent = (
  docx: DocxApi,
  accent: string,
  children: DOCX.MathRun[],
): DOCX.MathRun => {
  class MathAccent extends docx.XmlComponent {
    constructor() {
      super("m:acc");
      this.root.push(
        new docx.BuilderElement({
          name: "m:accPr",
          children: [docx.createMathAccentCharacter({ accent })],
        }),
      );
      this.root.push(docx.createMathBase({ children }));
    }
  }
  return asMathRun(new MathAccent());
};

/** Resolve accent base content from a macro's first braced argument. */
const accentChildrenFromArgs = (
  docx: DocxApi,
  args: latex.Argument[] | undefined,
): DOCX.MathRun[] =>
  hasCurlyBrackets(args?.[0]) ? mapGroup(docx, args[0].content) : [];

/** Build an accent node, deferring base content when the parser omits braced args. */
const mapAccentMacro = (
  docx: DocxApi,
  name: string,
  args: latex.Argument[] | undefined,
): MathComponent => {
  const accentChar = resolveAccentChar(name);
  if (!accentChar) {
    return makeMathRun(docx, name);
  }
  const children = accentChildrenFromArgs(docx, args);
  return children.length
    ? buildMathAccent(docx, accentChar, children)
    : { kind: "accent", accentChar };
};

/** Create an n-ary operator placeholder that accepts limits and a body later. */
const createPendingNAry = (
  accent: string,
  limitLocationVal?: string,
): PendingNAry => ({
  kind: "nary",
  accent,
  limitLocationVal,
  sub: [],
  sup: [],
  body: [],
});

/** Characters that end an n-ary integrand (e.g. `\int ... dx =`). */
const terminatesNAryBody = (content: string): boolean =>
  content === "=" || content === "," || content === ";";

const finalizeBodyRuns = (
  docx: DocxApi,
  body: MathComponent[],
): DOCX.MathRun[] =>
  body.map((component) =>
    isMathRun(component) ? component : finalizeComponent(docx, component),
  );

const finalizeTrailingPendingScriptInBody = (
  docx: DocxApi,
  prev: PendingNAry,
): PendingNAry => {
  const body = [...prev.body];
  const last = body[body.length - 1];
  if (last && isPendingScript(last)) {
    body[body.length - 1] = finalizeScript(docx, last);
  }
  return { ...prev, body };
};

const appendToNAryBody = (
  docx: DocxApi,
  prev: PendingNAry,
  items: MathComponent[],
): PendingNAry => {
  const nary = finalizeTrailingPendingScriptInBody(docx, prev);
  const body = [...nary.body];
  const lastBody = body[body.length - 1];
  const mathRuns = items.filter(isMathRun);

  if (isPendingAccent(lastBody) && mathRuns.length === items.length) {
    body.pop();
    body.push(buildMathAccent(docx, lastBody.accentChar, mathRuns));
    return { ...nary, body };
  }

  return { ...nary, body: [...body, ...items] };
};

const applyScriptToNAryBody = (
  docx: DocxApi,
  prev: PendingNAry,
  variant: "sub" | "sup",
  script: DOCX.MathRun[],
): PendingNAry => {
  const body = [...prev.body];
  const last = body.pop();
  if (!last) return prev;

  let updated: MathComponent;
  if (isPendingScript(last)) {
    if (variant === "sup") {
      updated =
        last.variant === "sub"
          ? finalizeScript(docx, {
              kind: "script",
              variant: "both",
              base: last.base,
              sub: last.sub,
              sup: script,
            })
          : finalizeScript(docx, last);
    } else {
      updated =
        last.variant === "sup"
          ? finalizeScript(docx, {
              kind: "script",
              variant: "both",
              base: last.base,
              sub: script,
              sup: last.sup,
            })
          : finalizeScript(docx, last);
    }
  } else if (isMathRun(last)) {
    updated =
      variant === "sup"
        ? { kind: "script", variant: "sup", base: last, sup: script }
        : { kind: "script", variant: "sub", base: last, sub: script };
  } else {
    body.push(last);
    return prev;
  }

  body.push(updated);
  return { ...prev, body };
};

const finalizePendingNAry = (docx: DocxApi, prev: PendingNAry): DOCX.MathRun =>
  finalizeNAry(docx, prev, finalizeBodyRuns(docx, prev.body));

const attachNArySub = (
  prev: PendingNAry,
  subScript: DOCX.MathRun[],
): PendingNAry => ({ ...prev, sub: subScript });

const attachNArySup = (
  prev: PendingNAry,
  superScript: DOCX.MathRun[],
): PendingNAry => ({ ...prev, sup: superScript });

const finalizeNAry = (
  docx: DocxApi,
  prev: PendingNAry,
  children: DOCX.MathRun[],
): DOCX.MathRun =>
  buildNAry(docx, {
    accent: prev.accent,
    limitLocationVal: prev.limitLocationVal,
    children,
    subScript: prev.sub,
    superScript: prev.sup,
  });

const isScriptMacro = (node: latex.Node): boolean =>
  node.type === "macro" && (node.content === "_" || node.content === "^");

/** Finalize a trailing script marker before processing the next non-script node. */
const finalizeTrailingPendingScript = (
  docx: DocxApi,
  ctx: MapContext,
): void => {
  const last = ctx.runs[ctx.runs.length - 1];
  if (isPendingScript(last)) {
    ctx.runs[ctx.runs.length - 1] = finalizeScript(docx, last);
  }
};

/** Convert unfinalized internal markers to OMML for output. */
const finalizeComponent = (
  docx: DocxApi,
  component: MathComponent,
): DOCX.MathRun => {
  if (isMathRun(component)) return component;
  switch (component.kind) {
    case "nary":
      return finalizePendingNAry(docx, component);
    case "accent":
      return buildMathAccent(docx, component.accentChar, []);
    case "limitsText":
      return makeMathRun(docx, component.name);
    case "script":
      return finalizeScript(docx, component);
  }
};

const finalizeScript = (
  docx: DocxApi,
  pending: PendingScript,
): DOCX.MathRun => {
  switch (pending.variant) {
    case "both":
      return new docx.MathSubSuperScript({
        subScript: pending.sub,
        superScript: pending.sup,
        children: [pending.base],
      });
    case "sub":
      return new docx.MathSubScript({
        children: [pending.base],
        subScript: pending.sub,
      });
    case "sup":
      return new docx.MathSuperScript({
        children: [pending.base],
        superScript: pending.sup,
      });
  }
};

const createMapContext = (): MapContext => ({
  runs: [],
  binom: { phase: "idle" },
});

/** convert group to Math */
const mapGroup = (docx: DocxApi, nodes: latex.Node[]): DOCX.MathRun[] => {
  const groupCtx = createMapContext();
  for (const c of nodes) {
    const result = mapNode(docx, c, groupCtx);
    if (result.type === "continue") {
      groupCtx.runs.push(...result.components);
    }
  }
  return groupCtx.runs.map((c) =>
    isMathRun(c) ? c : finalizeComponent(docx, c),
  );
};

/** Handle Macros */
// skipcq: JS-R1005
const mapMacro = (
  docx: DocxApi,
  node: latex.Macro,
  ctx: MapContext,
): MathComponent[] | MathComponent | null => {
  let returnVal: MathComponent[] | MathComponent | null = null;
  const { runs } = ctx;
  switch (node.content) {
    case "newline":
      returnVal = makeMathRun(docx, " ");
      break;
    case "\\":
      return null;
    case "textcolor": {
      const args = node.args ?? [];
      if (hasCurlyBrackets(args[2])) {
        returnVal = mapGroup(docx, args[2].content);
      }
      break;
    }
    case "color":
      return [];
    case "text": {
      const args = node.args ?? [];
      if (hasCurlyBrackets(args[0])) {
        returnVal = mapGroup(docx, args[0].content);
      }
      break;
    }
    case "^": {
      const prev = runs.pop();
      if (!prev) break;
      const superScript = mapGroup(docx, node.args?.[0]?.content ?? []);
      if (isPendingNAry(prev)) {
        if (prev.body.length === 0) {
          return attachNArySup(prev, superScript);
        }
        return applyScriptToNAryBody(docx, prev, "sup", superScript);
      }
      if (isPendingScript(prev)) {
        if (prev.variant === "sub") {
          return finalizeScript(docx, {
            kind: "script",
            variant: "both",
            base: prev.base,
            sub: prev.sub,
            sup: superScript,
          });
        }
        return finalizeScript(docx, prev);
      }
      if (!isMathRun(prev)) break;
      return {
        kind: "script",
        variant: "sup",
        base: prev,
        sup: superScript,
      };
    }
    case "_": {
      const prev = runs.pop();
      if (!prev) break;
      const subScript = mapGroup(docx, node.args?.[0]?.content ?? []);
      if (isPendingLimitsTextOp(prev)) {
        return new docx.MathLimitLower({
          children: [makeMathRun(docx, prev.name)],
          limit: subScript,
        });
      }
      if (isPendingNAry(prev)) {
        if (prev.body.length === 0) {
          return attachNArySub(prev, subScript);
        }
        return applyScriptToNAryBody(docx, prev, "sub", subScript);
      }
      if (isPendingScript(prev)) {
        if (prev.variant === "sup") {
          return finalizeScript(docx, {
            kind: "script",
            variant: "both",
            base: prev.base,
            sub: subScript,
            sup: prev.sup,
          });
        }
        return finalizeScript(docx, prev);
      }
      if (!isMathRun(prev)) break;
      return {
        kind: "script",
        variant: "sub",
        base: prev,
        sub: subScript,
      };
    }
    case "frac":
    case "tfrac":
    case "dfrac": {
      const args = node.args ?? [];
      if (
        args.length === 2 &&
        hasCurlyBrackets(args[0]) &&
        hasCurlyBrackets(args[1])
      ) {
        returnVal = new docx.MathFraction({
          numerator: mapGroup(docx, args[0].content),
          denominator: mapGroup(docx, args[1].content),
        });
      }
      break;
    }
    case "stackrel": {
      const args = node.args ?? [];
      if (
        args.length === 2 &&
        hasCurlyBrackets(args[0]) &&
        hasCurlyBrackets(args[1])
      ) {
        returnVal = new docx.MathLimitUpper({
          children: mapGroup(docx, args[1].content),
          limit: mapGroup(docx, args[0].content),
        });
      }
      break;
    }
    case "binom":
      ctx.binom = { phase: "needFirst" };
      return [];
    case "sqrt": {
      const args = node.args ?? [];
      if (args.length === 1) {
        returnVal = new docx.MathRadical({
          children: mapGroup(docx, args[0].content),
        });
      } else if (args.length === 2) {
        returnVal = new docx.MathRadical(
          args[0].content?.length
            ? {
                children: mapGroup(docx, args[1].content),
                degree: mapGroup(docx, args[0].content),
              }
            : { children: mapGroup(docx, args[1].content) },
        );
      }
      break;
    }
    case "left":
    case "right":
    case "boxed":
    case "boldsymbol":
      return [];
    case "mathbf":
      return mapGroup(docx, node.args?.[0]?.content ?? []);
    default: {
      const naryOp = resolveNAryOp(node.content);
      if (naryOp) {
        const pending = runs[runs.length - 1];
        if (isPendingNAry(pending)) {
          runs.pop();
          runs.push(finalizePendingNAry(docx, pending));
        }
        returnVal = createPendingNAry(naryOp.accent, naryOp.limitLocationVal);
      } else if (KATEX_LIMITS_TEXT_OPS.has(node.content)) {
        returnVal = { kind: "limitsText", name: node.content };
      } else if (
        node.content === "mathrm" ||
        node.content === "mathit" ||
        node.content === "textbf" ||
        node.content === "textit" ||
        node.content === "underline" ||
        node.content === "overbrace" ||
        node.content === "underbrace"
      ) {
        const args = node.args ?? [];
        if (hasCurlyBrackets(args[0])) {
          returnVal = mapGroup(docx, args[0].content);
        }
      } else if (isAccentCommand(node.content)) {
        returnVal = mapAccentMacro(docx, node.content, node.args);
      } else if (KATEX_FUNCTIONS.has(node.content)) {
        returnVal = makeMathRun(docx, node.content);
      } else {
        returnVal = makeMathRun(
          docx,
          resolveLatexSymbol(node.content) ?? node.content,
        );
      }
    }
  }
  const last = runs[runs.length - 1];
  if (isPendingNAry(last) && returnVal) {
    runs.pop();
    const items = Array.isArray(returnVal) ? returnVal : [returnVal];
    return appendToNAryBody(docx, last, items);
  }
  return returnVal;
};

const handleBinomialGroup = (
  docx: DocxApi,
  node: latex.Group,
  ctx: MapContext,
): MapNodeResult | null => {
  if (ctx.binom.phase === "idle") return null;

  const content = mapGroup(docx, node.content);
  if (ctx.binom.phase === "needFirst") {
    ctx.binom = { phase: "needSecond", numerator: content };
    return { type: "continue", components: [] };
  }

  const { numerator } = ctx.binom;
  ctx.binom = { phase: "idle" };
  return {
    type: "continue",
    components: [
      new docx.MathRoundBrackets({
        children: [
          new docx.MathFraction({
            numerator,
            denominator: content,
          }),
        ],
      }),
    ],
  };
};

/** Process node */
const mapNode = (
  docx: DocxApi,
  node: latex.Node,
  ctx: MapContext,
): MapNodeResult => {
  if (!isScriptMacro(node)) {
    finalizeTrailingPendingScript(docx, ctx);
  }

  if (node.type === "group") {
    const binomial = handleBinomialGroup(docx, node, ctx);
    if (binomial) return binomial;
  }

  let docxNodes: MathComponent[] = [];
  switch (node.type) {
    case "string":
      docxNodes = mapStringNode(docx, node.content);
      break;
    case "whitespace":
      if (isPendingNAry(ctx.runs[ctx.runs.length - 1])) {
        return { type: "continue", components: [] };
      }
      docxNodes = [makeMathRun(docx, " ")];
      break;
    case "macro": {
      const run = mapMacro(docx, node, ctx);
      if (!run) {
        return { type: "break" };
      }
      docxNodes = Array.isArray(run) ? run : [run];
      break;
    }
    case "group":
      docxNodes = mapGroup(docx, node.content);
      break;
    case "environment":
      break;
    default:
      break;
  }

  const last = ctx.runs[ctx.runs.length - 1];
  if (
    node.type === "string" &&
    isPendingNAry(last) &&
    terminatesNAryBody(node.content)
  ) {
    ctx.runs.pop();
    return {
      type: "continue",
      components: [
        finalizePendingNAry(docx, last),
        ...mapStringNode(docx, node.content),
      ],
    };
  }

  if (
    node.type !== "macro" &&
    node.type !== "whitespace" &&
    isPendingNAry(last)
  ) {
    ctx.runs.pop();
    return {
      type: "continue",
      components: [appendToNAryBody(docx, last, docxNodes)],
    };
  }

  const pendingAccent = ctx.runs[ctx.runs.length - 1];
  if (
    !isScriptMacro(node) &&
    node.type !== "whitespace" &&
    isPendingAccent(pendingAccent)
  ) {
    ctx.runs.pop();
    return {
      type: "continue",
      components: [
        buildMathAccent(
          docx,
          pendingAccent.accentChar,
          docxNodes.filter(isMathRun),
        ),
      ],
    };
  }

  return { type: "continue", components: docxNodes };
};

/** Parse latex and convert to DOCX MathRun nodes */
export const parseLatex = (docx: DocxApi, value: string): DOCX.MathRun[][] => {
  const latexNodes = parseMath(value);

  const paragraphs: MathComponent[][] = [[]];
  let ctx: MapContext = { runs: paragraphs[0], binom: { phase: "idle" } };

  for (const node of latexNodes) {
    const result = mapNode(docx, node, ctx);
    if (result.type === "break") {
      const runs: MathComponent[] = [];
      paragraphs.push(runs);
      ctx = { runs, binom: { phase: "idle" } };
    } else {
      ctx.runs.push(...result.components);
    }
  }

  return paragraphs.map((paragraph) =>
    paragraph.map((component) =>
      isMathRun(component) ? component : finalizeComponent(docx, component),
    ),
  );
};

/**
 * Math Plugin
 */
export const mathPlugin: () => IPlugin<{
  type: "" | "math" | "inlineMath";
  value?: string;
}> = () => {
  return {
    inline: (docx, node) => {
      if (node.type !== "inlineMath" && node.type !== "math") return [];
      (node as EmptyNode)._type = node.type;
      node.type = "";
      const latex = node.value ?? "";
      const children = parseLatex(docx, latex).flat();
      if (!children.length) {
        logSkippedEmptyMath(latex, "inline");
        return [];
      }
      return [new docx.Math({ children })];
    },
    block: (docx, node) => {
      if (node.type !== "math" && node.type !== "inlineMath") return [];
      node.type = "";
      const latex = node.value ?? "";
      return parseLatex(docx, latex).flatMap((runs) => {
        if (!runs.length) {
          logSkippedEmptyMath(latex, "block");
          return [];
        }
        return [
          new docx.Paragraph({ children: [new docx.Math({ children: runs })] }),
        ];
      });
    },
  };
};
