export interface AppHostCall { name: string; input: Record<string, unknown> }
export function createAppHost(deps: { mount: HTMLElement }): {
  handleToolCalls(calls: AppHostCall[]): Promise<void>;
} {
  void deps.mount;
  return { async handleToolCalls() { /* Task 4 wires the MCP Apps bridge here. */ } };
}
