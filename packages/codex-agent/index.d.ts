import type { IChatAgent, ChatAgentConfig, ChatAgentEvent } from "@any-code/utils";

export type { IChatAgent, ChatAgentConfig, ChatAgentEvent } from "@any-code/utils";

export declare class CodexAgent implements IChatAgent {
  readonly name: string;
  constructor(config: ChatAgentConfig);
  get sessionId(): string;
  init(): Promise<void>;
  on(event: string, handler: (data: any) => void): void;
  setWorkingDirectory(dir: string): void;
  getUsage(): Promise<any>;
  getContext(): Promise<any>;
  getSessionMessages(opts: { limit: number }): Promise<any>;
  chat(input: string): AsyncGenerator<ChatAgentEvent, void, unknown>;
  abort(): void;
  destroy(): Promise<void>;
}
