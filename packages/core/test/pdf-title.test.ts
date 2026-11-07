import { describe, expect, test } from "bun:test";
import type { PageBlock, TextItem } from "../src/pdf/layout.ts";
import { bookTitle } from "../src/pdf/title.ts";

// Page-1 values measured with pdf.js getTextContent after stripRunning (2026-11-07). PDF y grows upward.
const it = (str: string, x: number, y: number, fontSize: number): TextItem => ({ str, x, y, width: str.length * fontSize * 0.5, fontSize });
const head = (text: string, level: 1 | 2 = 2, page = 1): PageBlock => ({ kind: "heading", level, text, page });
const para = (text: string, page = 1): PageBlock => ({ kind: "para", text, page });

const NIH_TITLE =
  "Longitudinal Links between Fathers' and Mothers' Harsh Verbal Discipline and Adolescents' Conduct Problems and Depressive Symptoms";

/** nihms496502 (NIH author manuscript, 612 x 792): a 22 pt and a 14 pt masthead banner above the 14 pt title. */
const nih = {
  blocks: [
    head("NIH Public Access", 1),
    head("Author Manuscript"),
    para("Ming-Te Wang and Sarah Kenny University of Pittsburgh"),
    head(NIH_TITLE),
    para("Published in final edited form as: Child Dev. 2014 May"),
    para("We examined the reciprocal links between harsh verbal discipline and adolescents' problems."),
    head("Abstract"),
    head("Introduction", 2, 2),
  ],
  items: [
    it("NIH Public Access", 94.6, 754, 22),
    it("Author Manuscript", 94.6, 736.5, 14),
    it("Published in final edited form as:", 94.6, 690, 10),
    it("Longitudinal Links between Fathers' and Mothers' Harsh Verbal", 90, 650.9, 14),
    it("Discipline and Adolescents' Conduct Problems and Depressive", 90, 630.9, 14),
    it("Symptoms", 90, 610.9, 14),
    it("Ming-Te Wang and Sarah Kenny", 90, 580, 10),
    it("Abstract", 90, 507.5, 12),
    it("We examined the reciprocal links between harsh verbal discipline", 90, 490, 10),
  ],
  pageHeight: 792,
  metaTitle: undefined,
  fileName: "nihms496502.pdf",
};

/** arXiv 2302.13971 (595 x 842): the 14.35 pt title, a 33-word 11.96 pt author line, "Meta AI", sections. */
const LLAMA_TITLE = "LLaMA: Open and Efficient Foundation Language Models";
const AUTHORS =
  "Hugo Touvron∗, Thibaut Lavril∗, Gautier Izacard∗, Xavier Martinet Marie-Anne Lachaux, Timothee Lacroix, Baptiste Rozière, Naman Goyal Eric Hambro, Faisal Azhar, Aurelien Rodriguez, Armand Joulin Edouard Grave∗, Guillaume Lample∗";
const llama = {
  blocks: [head(LLAMA_TITLE, 1), head(AUTHORS), head("Meta AI"), head("Abstract"), para("We introduce LLaMA, a collection of foundation language models."), head("1 Introduction")],
  items: [
    it(LLAMA_TITLE, 117.3, 756.3, 14.35),
    it("Hugo Touvron", 129.7, 717.3, 11.96),
    it(", Thibaut Lavril", 203.8, 717.3, 11.96),
    it("Marie-Anne Lachaux, Timothee Lacroix, Baptiste Rozière, Naman Goyal", 111, 702.9, 11.96),
    it("Eric Hambro, Faisal Azhar, Aurelien Rodriguez, Armand Joulin", 133.9, 688.5, 11.96),
    it("Edouard Grave", 206.8, 674.1, 11.96),
    it("Meta AI", 277.6, 651.8, 11.96),
    it("Abstract", 157.8, 618.3, 11.96),
    it("We introduce LLaMA, a collection of foundation language models.", 70.9, 600, 9.96),
    it("1", 70.9, 441.9, 11.96),
    it("1", 300, 120, 7.97),
    it("Introduction", 88.8, 441.9, 11.96),
  ],
  pageHeight: 841.89,
  metaTitle: "",
  fileName: "arxiv-2302.13971v1.pdf",
};

/** fixtures/make-pdf.ts makeTwoColumnPdf (600 x 800): an 18 pt title 32 pt below the page top, metadata Title set. */
const twoColumn = {
  blocks: [head("A Generated Two Column Paper", 1), head("1 Introduction"), para("Left column text."), head("2 Method"), head("3 Results")],
  items: [
    it("A Generated Two Column Paper", 160, 750, 18),
    it("1 Introduction", 50, 700, 12),
    it("Left column text.", 50, 680, 10),
    it("2 Method", 50, 600, 12),
    it("3 Results", 320, 700, 12),
  ],
  pageHeight: 800,
  metaTitle: "Generated Two Column Sample",
  fileName: "two-column.pdf",
};

describe("bookTitle on an NIH author manuscript", () => {
  test("takes the article title, not the masthead banner", () => {
    expect(bookTitle(nih).title).toBe(NIH_TITLE);
  });

  test("points at the title block", () => {
    expect(bookTitle(nih).at).toBe(3);
  });

  test("skips both masthead banners as chapters", () => {
    expect(bookTitle(nih).skip).toEqual([0, 1]);
  });
});

describe("bookTitle on arXiv 2302.13971", () => {
  test("takes the title over the longer author line set smaller", () => {
    expect(bookTitle(llama)).toEqual({ title: LLAMA_TITLE, at: 0, skip: [] });
  });
});

describe("bookTitle on the generated two-column paper", () => {
  test("keeps the title heading near the page top and skips nothing", () => {
    expect(bookTitle(twoColumn)).toEqual({ title: "A Generated Two Column Paper", at: 0, skip: [] });
  });
});

describe("bookTitle from metadata", () => {
  const bare = { blocks: [para("Plain text only.")], items: [it("Plain text only.", 72, 700, 10)], pageHeight: 792, fileName: "notes.pdf" };

  test("uses the metadata Title when page 1 has no title heading", () => {
    expect(bookTitle({ ...bare, metaTitle: " A Field Guide to Ferns " })).toEqual({ title: "A Field Guide to Ferns", at: -1, skip: [] });
  });

  test("passes over a generator label such as a Word file name and falls back to the file name", () => {
    expect(bookTitle({ ...bare, metaTitle: "Microsoft Word - draft_v3.docx" }).title).toBe("notes");
  });

  test("passes over an untitled placeholder", () => {
    expect(bookTitle({ ...bare, metaTitle: "Untitled" }).title).toBe("notes");
  });
});

test("a journal running line set large is not the title", () => {
  const input = {
    blocks: [head("J Fam Psychol. 2014; 28(3): 412-420. doi:10.1037/a0036512", 1), head("Parenting Styles and Sibling Conflict in Middle Childhood"), head("Method")],
    items: [
      it("J Fam Psychol. 2014; 28(3): 412-420. doi:10.1037/a0036512", 72, 690, 16),
      it("Parenting Styles and Sibling Conflict in Middle Childhood", 72, 640, 14),
      it("Method", 72, 500, 12),
    ],
    pageHeight: 792,
    fileName: "x.pdf",
  };
  expect(bookTitle(input).title).toBe("Parenting Styles and Sibling Conflict in Middle Childhood");
});
