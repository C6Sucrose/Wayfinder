export interface AgentResult {
  reply: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}
export interface HistoryEntry { role: "user" | "assistant"; text: string }
export interface Brain {
  respond(utterance: string, history: HistoryEntry[]): Promise<AgentResult>;
}
