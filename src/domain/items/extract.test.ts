import { describe, it, expect } from "vitest";
import { MINIMAL_PDF } from "@/test/fixtures";
import { extractPdfText } from "./extract";

describe("extractPdfText", () => {
  it("returns the page text without page markers", async () => {
    const result = await extractPdfText(MINIMAL_PDF);
    expect(result.pageCount).toBe(1);
    expect(result.text).toBe("Hello Brain");
  });

  it("rejects non-PDF bytes", async () => {
    await expect(extractPdfText(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
