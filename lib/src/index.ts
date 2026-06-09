import { EmptyNode, IPlugin } from "@m2d/core";
import { parseMath } from "latex-math";
// skipcq: JS-C1003
import * as DOCX from "docx";
// skipcq: JS-C1003
import type * as latex from "@unified-latex/unified-latex-types";
import { KATEX_ACCENTS, KATEX_ALIASES, KATEX_FUNCTIONS, KATEX_SYMBOL_OVERRIDES } from "./katexMeta";
import { KATEX_SYMBOLS } from "./katexSymbols";

/**
 * Checks if the argument has curly brackets.
 */
const hasCurlyBrackets = (arg: latex.Argument | undefined): arg is latex.Argument =>
  Boolean(arg && arg.openMark === "{" && arg.closeMark === "}");

/** convert to MathRun */
const mapString = (docx: typeof DOCX, s: string): DOCX.MathRun => new docx.MathRun(s);

const resolveLatexSymbol = (name: string): string | undefined =>
  KATEX_SYMBOL_OVERRIDES[name] ?? KATEX_SYMBOLS[name] ?? KATEX_ALIASES[name];

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
  runs: DOCX.MathRun[],
): DOCX.MathRun[] | DOCX.MathRun | null => {
  let returnVal: DOCX.MathRun[] | DOCX.MathRun | null = null;
  switch (node.content) {
    case "newline":
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
      // @ts-expect-error -- using extra vars
      if (prev.isSum) {
        const docNode = new docx.MathSum({
          children: [],
          superScript,
          // @ts-expect-error -- reading extra field
          subScript: prev.sub,
        });

        // @ts-expect-error -- attaching extra field
        docNode.sub = prev.sub;
        // @ts-expect-error -- attaching extra field
        docNode.sup = superScript;
        // @ts-expect-error -- attaching extra field
        docNode.isSum = 1;
        return docNode;
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
      // @ts-expect-error -- attaching extra field
      if (prev.isSum) {
        const docNode = new docx.MathSum({
          children: [],
          subScript,
          // @ts-expect-error -- reading extra field
          superScript: prev.sup,
        });
        // @ts-expect-error -- attaching extra field
        docNode.sup = prev.sup;
        // @ts-expect-error -- attaching extra field
        docNode.sub = subScript;
        // @ts-expect-error -- attaching extra field
        docNode.isSum = 1;
        return docNode;
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
    case "sum": {
      const docNode = new docx.MathSum({
        children: [],
      });
      // @ts-expect-error - extra var
      docNode.isSum = 1;
      return docNode;
    }
    case "frac":
    case "tfrac":
    case "dfrac": {
      const args = node.args ?? [];
      if (args.length === 2 && hasCurlyBrackets(args[0]) && hasCurlyBrackets(args[1])) {
        returnVal = new docx.MathFraction({
          numerator: mapGroup(docx, args[0].content),
          denominator: mapGroup(docx, args[1].content),
        });
      }
      break;
    }
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
      return [];
    case "mathbf":
      return mapGroup(docx, node.args?.[0]?.content ?? []);
    default:
      if (KATEX_ACCENTS[node.content]) {
        returnVal = docx.createMathAccentCharacter({ accent: KATEX_ACCENTS[node.content] });
      } else if (KATEX_FUNCTIONS.has(node.content)) {
        returnVal = mapString(docx, node.content);
      } else {
        returnVal = mapString(docx, resolveLatexSymbol(node.content) ?? node.content);
      }
  }
  // @ts-expect-error -- reading extra field
  if (runs[runs.length - 1]?.isSum && returnVal) {
    const prev = runs.pop();
    return [
      new docx.MathSum({
        children: Array.isArray(returnVal) ? returnVal : [returnVal],
        // @ts-expect-error -- reading extra field
        superScript: prev.sup,
        // @ts-expect-error -- reading extra field
        subScript: prev.sub,
      }),
    ];
  }
  return returnVal;
};

/** Process node */
const mapNode = (
  docx: typeof DOCX,
  node: latex.Node,
  runs: DOCX.MathRun[],
): DOCX.MathRun[] | false => {
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

  // @ts-expect-error -- reading extra field
  if (node.type !== "macro" && runs[runs.length - 1]?.isSum) {
    const prev = runs.pop();
    return [
      new docx.MathSum({
        children: docxNodes,
        // @ts-expect-error -- reading extra field
        superScript: prev.sup,
        // @ts-expect-error -- reading extra field
        subScript: prev.sub,
      }),
    ];
  }

  return docxNodes;
};

/** Parse latex and convert to DOCX MathRun nodes */
export const parseLatex = (docx: typeof DOCX, value: string): DOCX.MathRun[][] => {
  const latexNodes = parseMath(value);

  const paragraphs: DOCX.MathRun[][] = [[]];
  let runs: DOCX.MathRun[] = paragraphs[0];

  for (const node of latexNodes) {
    const res = mapNode(docx, node, runs);
    if (!res) {
      // line break
      paragraphs.push((runs = []));
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
      return [new docx.Math({ children: parseLatex(docx, node.value ?? "").flat() })];
    },
    block: (docx, node) => {
      if (node.type !== "math" && node.type !== "inlineMath") return [];
      node.type = "";
      return parseLatex(docx, node.value ?? "").map(
        runs => new docx.Paragraph({ children: [new docx.Math({ children: runs })] }),
      );
    },
  };
};
