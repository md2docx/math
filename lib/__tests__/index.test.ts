import { describe, it, vi } from "vitest";
import { toDocx } from "@m2d/core"; // Adjust path based on your setup
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import fs from "fs";
import { mathPlugin } from "../src";

const markdown = fs.readFileSync("../sample.md", "utf-8");

const emptyOMathCount = async (md: string) => {
  const mdast = unified().use(remarkParse).use(remarkMath).parse(md);
  const buffer = (await toDocx(mdast, {}, { plugins: [mathPlugin()] }, "nodebuffer")) as Buffer;
  const { execSync } = await import("child_process");
  const path = `/tmp/m2d-math-test-${Math.random()}.docx`;
  fs.writeFileSync(path, buffer);
  const xml = execSync(`unzip -p ${path} word/document.xml`, { encoding: "utf8" });
  return (xml.match(/<m:oMath\s*\/>/g) ?? []).length;
};

describe("toDocx", () => {
  it("should handle maths", async ({ expect }) => {
    const mdast = unified().use(remarkParse).use(remarkMath).parse(markdown);

    const docxBlob = await toDocx(mdast, {}, { plugins: [mathPlugin()] });

    expect(docxBlob).toBeInstanceOf(Blob);
  });

  it("should not emit empty oMath for unrenderable inline math", async ({ expect }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await emptyOMathCount("$x$ cm$^{2}$")).toBe(0);
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});
