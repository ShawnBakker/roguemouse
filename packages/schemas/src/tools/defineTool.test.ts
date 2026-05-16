import { describe, it, expect } from "vitest";
import { z } from "zod";

import { defineTool, type ToolDefinition } from "./defineTool.js";

describe("defineTool — helper construction", () => {
  it("returns an object carrying the supplied name and schemas by reference", () => {
    const argsSchema = z.object({ x: z.string() }).strict();
    const resultDataSchema = z.object({ y: z.number().int() }).strict();
    const tool = defineTool("test:example", argsSchema, resultDataSchema);

    expect(tool.name).toBe("test:example");
    expect(tool.argsSchema).toBe(argsSchema);
    expect(tool.resultDataSchema).toBe(resultDataSchema);
  });

  it("preserves the literal type of the name in the return type", () => {
    const tool = defineTool(
      "literal:test",
      z.object({}).strict(),
      z.object({}).strict(),
    );

    const _exact: "literal:test" = tool.name;
    void _exact;

    // @ts-expect-error — "different:literal" is not assignable to tool.name
    const _wrong: "different:literal" = tool.name;
    void _wrong;

    expect(tool.name).toBe("literal:test");
  });

  it("returns a ToolDefinition shape that runtime-validates its schemas", () => {
    const tool = defineTool(
      "another:tool",
      z.object({ input: z.string() }).strict(),
      z.object({ output: z.boolean() }).strict(),
    );

    expect(tool.argsSchema.safeParse({ input: "x" }).success).toBe(true);
    expect(tool.argsSchema.safeParse({ input: 42 }).success).toBe(false);
    expect(tool.resultDataSchema.safeParse({ output: true }).success).toBe(true);
    expect(tool.resultDataSchema.safeParse({ output: "yes" }).success).toBe(false);
  });

  it("conforms to the ToolDefinition shape at the type level", () => {
    const tool = defineTool(
      "shape:check",
      z.object({}).strict(),
      z.object({}).strict(),
    );
    type T = typeof tool;
    type IsToolDefinition = T extends ToolDefinition<string, unknown, unknown>
      ? true
      : false;
    const _isToolDef: IsToolDefinition = true;
    void _isToolDef;

    expect(tool).toBeDefined();
  });
});

describe("defineTool — TypeScript constraints", () => {
  it("@ts-expect-error verifies non-string name fails to compile", () => {
    // @ts-expect-error — number is not assignable to TName extends string
    defineTool(42, z.object({}).strict(), z.object({}).strict());
  });

  it("@ts-expect-error verifies non-Zod argsSchema fails to compile", () => {
    // @ts-expect-error — string is not a z.ZodType
    defineTool("invalid", "not a schema", z.object({}).strict());
  });

  it("@ts-expect-error verifies non-Zod resultDataSchema fails to compile", () => {
    // @ts-expect-error — number is not a z.ZodType
    defineTool("invalid", z.object({}).strict(), 7);
  });
});
