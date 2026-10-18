import { describe, expect, it } from "vitest";
import { colorize } from "../../src/client/colorize.ts";

const ana = { id: 1, name: "Ana" };
const ben = { id: 2, name: "Ben" };
const viewer = { id: 9 };

describe("colorize", () => {
  it("passes plain text through", () => {
    expect(colorize("No names here", [ana, ben], viewer)).toEqual([
      { text: "No names here" },
    ]);
  });

  it("splits a sentence into name chunks with ids", () => {
    expect(colorize("Ana owes Ben $5.00", [ana, ben], viewer)).toEqual([
      { text: "Ana", person: ana },
      { text: " owes " },
      { text: "Ben", person: ben },
      { text: " $5.00" },
    ]);
  });

  it("colors the viewer's you/your/yours", () => {
    expect(colorize("You owe Ana your $5", [ana], viewer)).toEqual([
      { text: "You", person: { id: 9, name: "" } },
      { text: " owe " },
      { text: "Ana", person: ana },
      { text: " " },
      { text: "your", person: { id: 9, name: "" } },
      { text: " $5" },
    ]);
  });

  it("keeps a trailing 's attached to the name", () => {
    expect(colorize("Ben's share", [ben], viewer)).toEqual([
      { text: "Ben's", person: ben },
      { text: " share" },
    ]);
  });

  it("prefers the longest name at the same position", () => {
    const anna = { id: 3, name: "Anna" };
    expect(colorize("Anna paid", [ana, anna], viewer)).toEqual([
      { text: "Anna", person: anna },
      { text: " paid" },
    ]);
  });

  it("does not match inside words", () => {
    expect(colorize("Analyze this", [ana], viewer)).toEqual([
      { text: "Analyze this" },
    ]);
  });

  it("skips one-letter names and anyone named You", () => {
    expect(colorize("A you You", [{ name: "A" }, { name: "You" }])).toEqual([
      { text: "A you You" },
    ]);
  });

  it("gives duplicate names one color (first wins)", () => {
    const other = { id: 4, name: "Ana" };
    expect(colorize("Ana", [ana, other])).toEqual([
      { text: "Ana", person: ana },
    ]);
  });
});
