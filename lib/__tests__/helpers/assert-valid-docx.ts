import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toDocx } from "@m2d/core";
import { validateFile } from "@xarsh/ooxml-validator";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { mathPlugin } from "../../src";

const markdownProcessor = unified().use(remarkParse).use(remarkMath);

type MdastRoot = Parameters<typeof toDocx>[0];

export type DocxValidationResult = Awaited<ReturnType<typeof validateFile>>;

/** Directory for generated DOCX files used in manual inspection. */
export const DEBUG_DOCX_DIR = path.resolve(
  import.meta.dirname,
  "../../../debug",
);

/** Write a debug artifact under {@link DEBUG_DOCX_DIR}. */
export const saveDebugFile = (
  filename: string,
  content: string | Buffer,
): string => {
  const filePath = path.join(DEBUG_DOCX_DIR, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
};

/** Write a DOCX buffer under {@link DEBUG_DOCX_DIR} for manual testing. */
export const saveDebugDocx = (filename: string, buffer: Buffer): string =>
  saveDebugFile(filename, buffer);

/** Root directory for OOXML validation fixture markdown files. */
export const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

/** Recursively list all `.md` fixture files under {@link FIXTURES_DIR}. */
export const listFixtureFiles = (): string[] => {
  const fixtures: string[] = [];

  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        fixtures.push(filePath);
      }
    }
  };

  walk(FIXTURES_DIR);
  return fixtures.sort();
};

/** Recursively list individual `.md` fixture files (excludes `combined/`). */
export const listIndividualFixtureFiles = (): string[] =>
  listFixtureFiles().filter(
    (fixturePath) => !fixturePath.includes(`${path.sep}combined${path.sep}`),
  );

/** Map a fixture markdown path to its debug DOCX output path. */
export const fixtureDebugDocxPath = (fixturePath: string): string =>
  `${path.relative(FIXTURES_DIR, fixturePath).replace(/\.md$/, ".docx")}`;

/** Build one markdown document containing every individual fixture. */
export const buildCombinedFixtureMarkdown = (): string =>
  listIndividualFixtureFiles()
    .map((fixturePath) => {
      const label = path
        .relative(FIXTURES_DIR, fixturePath)
        .replace(/\.md$/, "")
        .replace(/\//g, " / ");
      const body = fs.readFileSync(fixturePath, "utf-8").trim();

      return `**${label}**\n\n${body}`;
    })
    .join("\n\n---\n\n");

/** Generate a DOCX buffer from markdown using the math plugin. */
export const docxFromMarkdown = async (markdown: string): Promise<Buffer> => {
  const tree = markdownProcessor.parse(markdown);
  const normalized = markdownProcessor.runSync(tree);

  return (await toDocx(
    normalized as MdastRoot,
    {},
    { plugins: [mathPlugin()] },
    "nodebuffer",
  )) as Buffer;
};

/** Validate a DOCX buffer against Microsoft's OOXML schema. */
export const validateDocxBuffer = async (
  buffer: Buffer | Uint8Array,
): Promise<DocxValidationResult> => {
  const file = path.join(
    os.tmpdir(),
    `m2d-math-docx-${crypto.randomUUID()}.docx`,
  );

  try {
    fs.writeFileSync(file, buffer);
    return await validateFile(file, { officeVersion: "Microsoft365" });
  } finally {
    fs.unlinkSync(file);
  }
};

/** Format schema validation errors for test output. */
export const formatDocxValidationErrors = (
  result: DocxValidationResult,
): string =>
  result.errors
    .map(
      (error) =>
        `[${error.errorType}] ${error.path}\n  ${error.xPath}\n  ${error.description}`,
    )
    .join("\n\n");
