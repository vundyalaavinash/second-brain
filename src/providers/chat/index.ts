import type { DB } from "@/db/client";
import { getSetting } from "@/domain/settings";
import { createAnthropicChatProvider } from "./anthropic";
import type { ChatProvider } from "./types";

export type { ChatProvider, StructuredRequest } from "./types";
export { CHAT_MODEL } from "./anthropic";

/** Where the key lives when it is not in the environment. */
export const CHAT_KEY_SETTING = "anthropic.apiKey";

/** The environment wins over the setting, so a shell can override what the app has stored. */
export function chatApiKey(db: DB): string {
  return process.env.ANTHROPIC_API_KEY?.trim() || getSetting(db, CHAT_KEY_SETTING, "").trim();
}

/** The same check as `getChatProvider`, without building a client nobody would call. */
export function hasChatKey(db: DB): boolean {
  return chatApiKey(db).length > 0;
}

/** Null when no key resolves: every caller treats that as "this feature is off". */
export function getChatProvider(db: DB): ChatProvider | null {
  const key = chatApiKey(db);
  return key ? createAnthropicChatProvider(key) : null;
}
