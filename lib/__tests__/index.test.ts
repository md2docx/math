import fs from "node:fs";
import { toDocx } from "@m2d/core"; // Adjust path based on your setup
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, it } from "vitest";
import { mathPlugin } from "../src";

const markdown = fs.readFileSync("../sample.md", "utf-8");

describe("toDocx", () => {
  it("should handle maths", async ({ expect }) => {
    const mdast = unified().use(remarkParse).use(remarkMath).parse(markdown);

    const docxBlob = await toDocx(mdast, {}, { plugins: [mathPlugin()] });

    expect(docxBlob).toBeInstanceOf(Blob);
  });
});
