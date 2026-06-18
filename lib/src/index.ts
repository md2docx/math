import type { EmptyNode, IPlugin } from "@m2d/core";
// skipcq: JS-C1003
import type * as latex from "@unified-latex/unified-latex-types";
// skipcq: JS-C1003
import type * as DOCX from "docx";
import { parseMath } from "latex-math";
import {
  KATEX_ACCENTS,
  KATEX_ALIASES,
  KATEX_FUNCTIONS,
  KATEX_SYMBOL_OVERRIDES,
} from "./katexMeta";
import { KATEX_SYMBOLS } from "./katexSymbols";

/**
 * Checks if the argument has curly brackets.
 */
const hasCurlyBrackets = (
  arg: latex.Argument | undefined,
): arg is latex.Argument =>
  Boolean(arg && arg.openMark === "{" && arg.closeMark === "}");

/** convert to MathRun */
const mapString = (docx: typeof DOCX, s: string): DOCX.MathRun =>
  new docx.MathRun(s);

const PLUGIN_ID = "@m2d/math";

/** Log and skip inline/block math that would emit empty OMML. */
const logSkippedEmptyMath = (latex: string, scope: "inline" | "block") => {
  console.error(
    `[${PLUGIN_ID}] Skipping empty ${scope} math for ${JSON.stringify(latex)}; no renderable OMML was produced. Empty <m:oMath> elements break Microsoft Word.`,
  );
};

/** Resolve a LaTeX command name to its Unicode symbol. */
const resolveLatexSymbol = (name: string): string | undefined =>
  KATEX_SYMBOL_OVERRIDES[name] ?? KATEX_SYMBOLS[name] ?? KATEX_ALIASES[name];

type NAryOptions = {
  accent: string;
  limitLocationVal?: string;
  children?: DOCX.MathRun[];
  subScript?: DOCX.MathRun[];
  superScript?: DOCX.MathRun[];
};

type PendingNAry = DOCX.MathRun & {
  isNAry: 1;
  naryAccent: string;
  naryLimitLoc?: string;
  sub?: DOCX.MathRun[];
  sup?: DOCX.MathRun[];
};

const NARY_OPERATORS: Record<
  string,
  { accent: string; limitLocationVal?: string }
> = {
  sum: { accent: "∑" },
  prod: { accent: "∏" },
  int: { accent: "∫", limitLocationVal: "subSup" },
  iint: { accent: "∬", limitLocationVal: "subSup" },
  iiint: { accent: "∭", limitLocationVal: "subSup" },
  oint: { accent: "∮", limitLocationVal: "subSup" },
  oiint: { accent: "∯", limitLocationVal: "subSup" },
  oiiint: { accent: "∰", limitLocationVal: "subSup" },
  bigcup: { accent: "⋃" },
  bigcap: { accent: "⋂" },
  bigoplus: { accent: "⊕" },
  bigotimes: { accent: "⊗" },
};

/** Whether a MathRun is a pending n-ary operator awaiting limits or body. */
const isPendingNAry = (node: DOCX.MathRun | undefined): node is PendingNAry =>
  Boolean(node && (node as PendingNAry).isNAry);

/** Build an OMML n-ary operator element. */
const buildNAry = (docx: typeof DOCX, options: NAryOptions): DOCX.MathRun => {
  /** OMML wrapper for n-ary operators such as sum and integral. */
  class MathNAry extends docx.XmlComponent {
    constructor() {
      super("m:nary");
      this.root.push(
        docx.createMathNAryProperties({
          accent: options.accent,
          hasSuperScript: Boolean(options.superScript),
          hasSubScript: Boolean(options.subScript),
          limitLocationVal: options.limitLocationVal,
        }),
      );
      if (options.subScript) {
        this.root.push(
          docx.createMathSubScriptElement({ children: options.subScript }),
        );
      }
      if (options.superScript) {
        this.root.push(
          docx.createMathSuperScriptElement({ children: options.superScript }),
        );
      }
      this.root.push(docx.createMathBase({ children: options.children ?? [] }));
    }
  }
  return new MathNAry() as unknown as DOCX.MathRun;
};

/** Create an n-ary operator placeholder that accepts limits and a body later. */
const createPendingNAry = (
  docx: typeof DOCX,
  accent: string,
  limitLocationVal?: string,
): PendingNAry => {
  const node = buildNAry(docx, {
    accent,
    limitLocationVal,
    children: [],
  }) as PendingNAry;
  node.isNAry = 1;
  node.naryAccent = accent;
  node.naryLimitLoc = limitLocationVal;
  return node;
};

/** Attach sub/superscript limits to a pending n-ary operator. */
const attachNAryLimits = (
  docx: typeof DOCX,
  prev: PendingNAry,
  limits: { subScript?: DOCX.MathRun[]; superScript?: DOCX.MathRun[] },
): PendingNAry => {
  const sub = limits.subScript ?? prev.sub;
  const sup = limits.superScript ?? prev.sup;
  const node = buildNAry(docx, {
    accent: prev.naryAccent,
    limitLocationVal: prev.naryLimitLoc,
    children: [],
    subScript: sub,
    superScript: sup,
  }) as PendingNAry;
  node.isNAry = 1;
  node.naryAccent = prev.naryAccent;
  node.naryLimitLoc = prev.naryLimitLoc;
  node.sub = sub;
  node.sup = sup;
  return node;
};

const finalizeNAry = (
  docx: typeof DOCX,
  prev: PendingNAry,
  children: DOCX.MathRun[],
): DOCX.MathRun =>
  buildNAry(docx, {
    accent: prev.naryAccent,
    limitLocationVal: prev.naryLimitLoc,
    children,
    subScript: prev.sub,
    superScript: prev.sup,
  });

/** convert group to Math */
const mapGroup = (docx: typeof DOCX, nodes: latex.Node[]): DOCX.MathRun[] => {
  const group: DOCX.MathRun[] = [];
  for (const c of nodes) {
    // skipcq: JS-0357
    group.push(...(mapNode(docx, c, group) || []));
  }
  return group;
};

/** Handle Macros */
// skipcq: JS-R1005
const mapMacro = (
  docx: typeof DOCX,
  node: latex.Macro,
  runs: DOCX.MathRun[] & { binomPending?: 0 | 1; binomFirst?: DOCX.MathRun[] },
): DOCX.MathRun[] | DOCX.MathRun | null => {
  let returnVal: DOCX.MathRun[] | DOCX.MathRun | null = null;
  switch (node.content) {
    case "newline":
      returnVal = mapString(docx, " ");
      break;
    case "\\":
      // line break
      return null;
    case "textcolor": {
      const args = node.args ?? [];
      // const _color = (hasCurlyBrackets(args[1]) && args[1]?.content?.[0]?.content) || "";
      if (hasCurlyBrackets(args[2])) {
        returnVal = mapGroup(docx, args[2].content);
      }
      break;
    }
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
        return attachNAryLimits(docx, prev, { superScript });
        // @ts-expect-error -- attaching extra field
      } else if (prev.sub) {
        return new docx.MathSubSuperScript({
          // @ts-expect-error -- attaching extra field
          subScript: prev.sub,
          superScript,
          // @ts-expect-error -- attaching extra field
          children: [prev.prev],
        });
      }
      const docxNode = new docx.MathSuperScript({
        children: [prev],
        superScript,
      });
      // @ts-expect-error -- attaching extra field
      docxNode.sup = superScript;
      // @ts-expect-error -- attaching extra field
      docxNode.prev = prev;
      return docxNode;
    }
    case "_": {
      const prev = runs.pop();
      if (!prev) break;
      const subScript = mapGroup(docx, node.args?.[0]?.content ?? []);
      if (isPendingNAry(prev)) {
        return attachNAryLimits(docx, prev, { subScript });
        // @ts-expect-error -- attaching extra field
      } else if (prev.sup) {
        return new docx.MathSubSuperScript({
          subScript,
          // @ts-expect-error -- attaching extra field
          superScript: prev.sup,
          // @ts-expect-error -- attaching extra field
          children: [prev.prev],
        });
      }
      const docxNode = new docx.MathSubScript({
        children: [prev],
        subScript,
      });
      // @ts-expect-error -- attaching extra field
      docxNode.sub = subScript;
      // @ts-expect-error -- attaching extra field
      docxNode.prev = prev;
      return docxNode;
    }
    case "hat":
    case "widehat":
      returnVal = docx.createMathAccentCharacter({
        accent: KATEX_ACCENTS[node.content] ?? "^",
      });
      break;
    case "sum":
    case "prod":
    case "int":
    case "iint":
    case "iiint":
    case "oint":
    case "oiint":
    case "oiiint":
    case "bigcup":
    case "bigcap":
    case "bigoplus":
    case "bigotimes": {
      const nary = NARY_OPERATORS[node.content];
      if (nary) {
        returnVal = createPendingNAry(docx, nary.accent, nary.limitLocationVal);
      }
      break;
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
        returnVal = [
          docx.createMathLimitLocation({ value: "undOvr" }),
          new docx.MathLimitUpper({
            children: mapGroup(docx, args[1].content),
            limit: mapGroup(docx, args[0].content),
          }),
        ];
      }
      break;
    }
    case "binom":
      runs.binomPending = 0;
      return [];
    case "sqrt": {
      const args = node.args ?? [];
      if (args.length === 1) {
        returnVal = new docx.MathRadical({
          children: mapGroup(docx, args[0].content),
        });
      } else if (args.length === 2) {
        returnVal = new docx.MathRadical(
          args[0].content
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
    case "vec":
    case "boxed":
    case "boldsymbol":
      return [];
    case "mathbf":
      return mapGroup(docx, node.args?.[0]?.content ?? []);
    default:
      if (node.content === "overline" || node.content === "widetilde") {
        returnVal = docx.createMathAccentCharacter({
          accent: node.content === "overline" ? "¯" : "~",
        });
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
      } else if (KATEX_ACCENTS[node.content]) {
        returnVal = docx.createMathAccentCharacter({
          accent: KATEX_ACCENTS[node.content],
        });
      } else if (KATEX_FUNCTIONS.has(node.content)) {
        returnVal = mapString(docx, node.content);
      } else {
        returnVal = mapString(
          docx,
          resolveLatexSymbol(node.content) ?? node.content,
        );
      }
  }
  if (isPendingNAry(runs[runs.length - 1]) && returnVal) {
    const prev = runs.pop() as PendingNAry;
    return [
      finalizeNAry(
        docx,
        prev,
        Array.isArray(returnVal) ? returnVal : [returnVal],
      ),
    ];
  }
  return returnVal;
};

/** Process node */
const mapNode = (
  docx: typeof DOCX,
  node: latex.Node,
  runs: DOCX.MathRun[] & { binomPending?: 0 | 1; binomFirst?: DOCX.MathRun[] },
): DOCX.MathRun[] | false => {
  if (node.type === "group" && runs.binomPending !== undefined) {
    const content = mapGroup(docx, node.content);
    if (runs.binomPending === 0) {
      runs.binomFirst = content;
      runs.binomPending = 1;
      return [];
    }
    delete runs.binomPending;
    const numerator = runs.binomFirst ?? [];
    delete runs.binomFirst;
    return [
      new docx.MathRoundBrackets({
        children: [
          new docx.MathFraction({
            numerator,
            denominator: content,
          }),
        ],
      }),
    ];
  }

  let docxNodes: DOCX.MathRun[] = [];
  switch (node.type) {
    case "string":
      docxNodes = [mapString(docx, node.content)];
      break;
    case "whitespace":
      docxNodes = [mapString(docx, " ")];
      break;
    case "macro": {
      const run = mapMacro(docx, node, runs);
      if (!run) {
        // line break
        return false;
      } else {
        docxNodes = Array.isArray(run) ? run : [run];
      }
      break;
    }
    case "group":
      docxNodes = mapGroup(docx, node.content);
      break;
    case "environment":
      // NOT SUPPORTED BY DOCX library
      break;
    default:
  }

  if (node.type !== "macro" && isPendingNAry(runs[runs.length - 1])) {
    const prev = runs.pop() as PendingNAry;
    return [finalizeNAry(docx, prev, docxNodes)];
  }

  return docxNodes;
};

/** Parse latex and convert to DOCX MathRun nodes */
export const parseLatex = (
  docx: typeof DOCX,
  value: string,
): DOCX.MathRun[][] => {
  const latexNodes = parseMath(value);

  const paragraphs: DOCX.MathRun[][] = [[]];
  let runs: DOCX.MathRun[] & {
    binomPending?: 0 | 1;
    binomFirst?: DOCX.MathRun[];
  } = paragraphs[0];

  for (const node of latexNodes) {
    const res = mapNode(docx, node, runs);
    if (!res) {
      // line break
      runs = [];
      paragraphs.push(runs);
    } else {
      runs.push(...res);
    }
  }
  return paragraphs;
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
      (node as unknown as EmptyNode)._type = node.type;
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
