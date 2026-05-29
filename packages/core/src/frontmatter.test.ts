import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeMemory } from "./frontmatter.js";
import { makeFrontmatter } from "./_testutil.js";

describe("frontmatter round-trip", () => {
  it("serialize → parse deep-equals the original frontmatter", () => {
    const fm = makeFrontmatter({
      id: "abcd1234",
      title: "A round-trip memory",
      tier: "procedural",
      type: "decision",
      status: "active",
      confidence: "high",
      importance: 7,
      strength: 4,
      created: "2026-01-02",
      last_reviewed: "2026-03-04",
      last_reinforced: "2026-05-06",
      tags: ["alpha", "beta"],
      links: [{ to: "deadbeef", rel: "extends" }],
      summary: "Round-trips without loss.",
    });
    const body = "Body line one.\n\nBody line two.";

    const serialized = serializeMemory(fm, body);
    const parsed = parseFrontmatter(serialized, "fallback");

    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body).toBe(body);
  });

  it("keeps stored dates as YYYY-MM-DD strings (no Date coercion)", () => {
    const fm = makeFrontmatter({ created: "2026-07-08", last_reinforced: "2026-07-09" });
    const parsed = parseFrontmatter(serializeMemory(fm, "x"), "fallback");
    expect(typeof parsed.frontmatter.created).toBe("string");
    expect(parsed.frontmatter.created).toBe("2026-07-08");
    expect(parsed.frontmatter.last_reinforced).toBe("2026-07-09");
  });

  it("preserves an all-digit-like id as a string (no number coercion)", () => {
    const fm = makeFrontmatter({ id: "1234567890" });
    const parsed = parseFrontmatter(serializeMemory(fm, "x"), "fallback");
    expect(typeof parsed.frontmatter.id).toBe("string");
    expect(parsed.frontmatter.id).toBe("1234567890");
  });
});
