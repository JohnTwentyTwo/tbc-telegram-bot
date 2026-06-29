export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  URLS: string;
  SNAPSHOT_INTERVAL: string;
}

export interface StoredSnapshot {
  url: string;
  content: string;
  title: string;
  at: string;
}

export type EnvBindings = {
  bindings: {
    kv: KVNamespace;
    // future: ai: Ai;
  };
};

export interface EnvWithKV extends Env, EnvBindings {}

export interface ParsedMessage {
  text: string;
  chatId: string;
  fromId: string;
  messageId: number;
}
