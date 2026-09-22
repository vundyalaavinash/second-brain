import type { z } from "zod";

/** One structured answer: the schema is both the instruction and the validation. */
export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** The tool's name, which is what the model is told it is filling in. */
  name: string;
  /** One line telling the model what the tool is for. */
  description?: string;
}

/**
 * The one thing the app asks a chat model for: a value of a shape it already knows. There is
 * no free-text call, because nothing in the app wants prose it would have to parse.
 */
export interface ChatProvider {
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}
