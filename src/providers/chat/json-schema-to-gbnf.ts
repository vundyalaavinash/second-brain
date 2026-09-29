/** The handful of JSON Schema shapes this app's own structured requests actually produce
 * (via Zod's `z.toJSONSchema()`) -- not the whole spec, just object/string/array/number/
 * boolean/enum, since that is everything a `StructuredRequest` schema in this app has ever
 * needed. Every field is required; nothing here has reached for `.optional()` yet, and an
 * optional field would need its own presence/absence alternative in the grammar, which this
 * intentionally does not attempt until something actually needs it.
 *
 * `properties`/`items` are typed `unknown` rather than recursively `JSONSchemaLike`: Zod's own
 * emitted type allows a bare `true`/`false` in either spot (meaning "anything"/"nothing" in the
 * JSON Schema spec), which this app's schemas never actually produce, and chasing that shape
 * exactly bought nothing but friction against Zod's own (correct) types -- `asNode` below is the
 * one place that narrows `unknown` back into something this converter can walk. */
export interface JSONSchemaLike {
  /** Zod emits an array here for a nullable field (e.g. `["string", "null"]`); the non-null
   * member is what decides this schema's shape, so the null half is dropped rather than
   * modelled -- nothing in this app has reached for `.nullable()` on a structured field yet. */
  type?: string | string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  enum?: unknown[];
  description?: string;
}

/** A property or array-item value is `unknown` at the type level (see above) but is, in every
 * schema this app actually builds, always an object -- never the bare `true`/`false` the spec
 * also allows. Falls back to "any string" for that theoretical case rather than throwing. */
function asNode(value: unknown): JSONSchemaLike {
  return typeof value === "object" && value !== null ? (value as JSONSchemaLike) : { type: "string" };
}

const JSON_CHAR = String.raw`[^"\\\x7F\x00-\x1F] | [\\] (["\\bfnrt] | "u" [0-9a-fA-F]{4})`;
const BASE_RULES = [
  `ws ::= [ \\t\\n]*`,
  `string ::= "\\"" char* "\\""`,
  `char ::= ${JSON_CHAR}`,
  `number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [+-]? [0-9]+)?`,
  `boolean ::= "true" | "false"`,
];

/**
 * `llama-cli`'s own `--json-schema`/`--json-schema-file` is where this would normally end --
 * point it at a JSON Schema and it derives the grammar itself. Current builds (see llamacpp.ts)
 * fail with "Failed to initialize samplers" the instant that path is used, even for a trivial
 * schema, while the identical grammar text handed to `--grammar` directly works fine -- so this
 * does the conversion `--json-schema-file` was supposed to do, and feeds the result through the
 * path that actually works.
 */
export function jsonSchemaToGrammar(schema: JSONSchemaLike): string {
  const rules = new Map<string, string>();
  let counter = 0;

  function visit(s: JSONSchemaLike, hint: string): string {
    if (s.enum) {
      const name = `${hint}-${counter++}`;
      rules.set(name, s.enum.map((v) => JSON.stringify(v)).join(" | "));
      return name;
    }
    const type = Array.isArray(s.type) ? (s.type.find((t) => t !== "null") ?? s.type[0]) : s.type;
    switch (type) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return '"null"';
      case "array": {
        const item = s.items ? visit(asNode(s.items), `${hint}-item`) : "string";
        const name = `${hint}-${counter++}`;
        rules.set(name, `"[" ws (${item} (ws "," ws ${item})*)? ws "]"`);
        return name;
      }
      case "object":
      default: {
        const props = s.properties ?? {};
        const name = `${hint}-${counter++}`;
        const fields = Object.entries(props).map(([key, propSchema]) => {
          // A rule name is a GBNF identifier (letters, digits, hyphens only) -- the JSON key
          // itself, `proposed_actions`, is not one (underscores aren't allowed in it), so the
          // identifier hint is sanitized separately from the quoted string literal below, which
          // still writes the key exactly as the schema names it.
          const valueRule = visit(asNode(propSchema), `${hint}-${key.replace(/[^a-zA-Z0-9]/g, "-")}`);
          return `"\\"${key}\\"" ws ":" ws ${valueRule}`;
        });
        rules.set(name, fields.length === 0 ? `"{" ws "}"` : `"{" ws ${fields.join(' ws "," ws ')} ws "}"`);
        return name;
      }
    }
  }

  // `visit` always mints a fresh name (never literally "root"), so the entry point GBNF expects
  // is written as a one-line alias to whichever rule the top-level schema actually produced.
  const topRule = visit(schema, "root");
  const lines = [`root ::= ${topRule}`];
  for (const [name, body] of rules) lines.push(`${name} ::= ${body}`);
  lines.push(...BASE_RULES);
  return lines.join("\n");
}
