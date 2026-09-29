import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonSchemaToGrammar } from "./json-schema-to-gbnf";

/** Every rule name defined (`name ::=`) is used somewhere as a reference, and every reference
 * resolves to a defined rule -- a grammar with either is one llama.cpp's parser rejects outright
 * (`failed to parse grammar`, a hard crash, found the hard way building this converter). */
function assertWellFormed(grammar: string): void {
  const defined = new Set([...grammar.matchAll(/^([a-zA-Z][a-zA-Z0-9-]*)\s*::=/gm)].map((m) => m[1]));
  expect(defined.has("root")).toBe(true);
  const referenced = new Set([...grammar.matchAll(/\b([a-zA-Z][a-zA-Z0-9-]*)\b(?!")/g)].map((m) => m[1]));
  for (const name of defined) expect(referenced.has(name)).toBe(true);
}

describe("jsonSchemaToGrammar", () => {
  it("builds a well-formed grammar for an object of strings", () => {
    const grammar = jsonSchemaToGrammar(z.toJSONSchema(z.object({ title: z.string(), body: z.string() })));
    assertWellFormed(grammar);
    // Keys land in the grammar as the escaped literal `\"title\"`, since the grammar itself is
    // built as a quoted GBNF string.
    expect(grammar).toContain('\\"title\\"');
    expect(grammar).toContain('\\"body\\"');
  });

  it("builds a well-formed grammar for a nested array of objects, the shape the meeting summary schema actually uses", () => {
    const Schema = z.object({
      summary: z.string(),
      decisions: z.array(z.string()),
      proposed_actions: z.array(z.object({ title: z.string(), notes: z.string() })),
    });
    const grammar = jsonSchemaToGrammar(z.toJSONSchema(Schema));
    assertWellFormed(grammar);
    // The JSON key itself keeps its underscore (it's a quoted string literal, written into the
    // grammar as the escaped literal `\"proposed_actions\"`); only the rule *name* built from it
    // needs sanitising, since GBNF identifiers don't allow one.
    expect(grammar).toContain('\\"proposed_actions\\"');
    expect(grammar).not.toMatch(/proposed_actions-\d+ ::=/);
  });

  it("sanitises an underscored property name into a valid GBNF identifier rather than crashing the parser", () => {
    const grammar = jsonSchemaToGrammar(z.toJSONSchema(z.object({ due_date: z.string() })));
    assertWellFormed(grammar);
    // A raw underscore in a rule identifier is exactly what made the very first version of this
    // grammar fail to parse at all (see llamacpp.ts's own account of that).
    expect(grammar).not.toMatch(/due_date-\d+ ::=/);
  });

  it("covers number, boolean and enum, not just string", () => {
    const grammar = jsonSchemaToGrammar(
      z.toJSONSchema(z.object({ count: z.number(), done: z.boolean(), priority: z.enum(["low", "high"]) })),
    );
    assertWellFormed(grammar);
    expect(grammar).toMatch(/"low" \| "high"/);
  });
});
