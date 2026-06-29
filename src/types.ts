export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  BASE_URL: string;
  URLS: string;
  CRON_SECRET: string;
  TOTAL_PAGES: string;
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
  };
};

export interface EnvWithKV extends Env, EnvBindings {}

export interface ParsedMessage {
  text: string;
  chatId: string;
  fromId: string;
  messageId: number;
}
