import fs from "node:fs";
import path from "node:path";
import { toDocx } from "@m2d/core";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it, vi } from "vitest";
import { mathPlugin } from "../src";
import {
  buildCombinedFixtureMarkdown,
  docxFromMarkdown,
  fixtureDebugDocxPath,
  formatDocxValidationErrors,
  listIndividualFixtureFiles,
  saveDebugDocx,
  saveDebugFile,
  validateDocxBuffer,
} from "./helpers/assert-valid-docx";

const markdown = fs.readFileSync("../sample.md", "utf-8");

const emptyOMathCount = async (md: string) => {
  const buffer = await docxFromMarkdown(md);
  const { execSync } = await import("node:child_process");
  const tempPath = `/tmp/m2d-math-test-${Math.random()}.docx`;
  fs.writeFileSync(tempPath, buffer);
  const xml = execSync(`unzip -p ${tempPath} word/document.xml`, {
    encoding: "utf8",
  });
  return (xml.match(/<m:oMath\s*\/>/g) ?? []).length;
};

describe("toDocx", () => {
  it("should handle maths", async ({ expect }) => {
    const mdast = unified().use(remarkParse).use(remarkMath).parse(markdown);

    const docxBlob = await toDocx(mdast, {}, { plugins: [mathPlugin()] });

    expect(docxBlob).toBeInstanceOf(Blob);
  });

  it("should not emit empty oMath for unrenderable inline math", async ({
    expect,
  }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await emptyOMathCount("$x$ cm$^{2}$")).toBe(0);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});

describe("OOXML schema validation", () => {
  it.each(
    listIndividualFixtureFiles().map((fixturePath) => [fixturePath]),
  )("passes for %s", async (fixturePath) => {
    const markdown = fs.readFileSync(fixturePath, "utf-8");
    const buffer = await docxFromMarkdown(markdown);
    saveDebugDocx(
      path.join("fixtures", fixtureDebugDocxPath(fixturePath)),
      buffer,
    );
    const result = await validateDocxBuffer(buffer);

    expect(result.ok, formatDocxValidationErrors(result)).toBe(true);
  });

  it("passes for combined all-fixtures document", async () => {
    const markdown = buildCombinedFixtureMarkdown();
    const buffer = await docxFromMarkdown(markdown);

    saveDebugFile("fixtures/combined/all-fixtures.md", markdown);
    saveDebugDocx("fixtures/combined/all-fixtures.docx", buffer);

    const result = await validateDocxBuffer(buffer);

    expect(result.ok, formatDocxValidationErrors(result)).toBe(true);
  });
});
