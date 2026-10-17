export type StageId = "capture" | "correlate" | "authority" | "record";

export const STAGES: ReadonlyArray<{ id: StageId; label: string; hint: string }> = [
  { id: "capture", label: "Capture", hint: "read the image" },
  { id: "correlate", label: "Correlate", hint: "threads and urgency" },
  { id: "authority", label: "Authority", hint: "allow, ask, refuse" },
  { id: "record", label: "Record", hint: "hash-chained receipt" }
];

const TOOL_STAGE: Record<string, StageId> = {
  capture_scan: "capture",
  get_scan: "capture",
  identify_product: "capture",
  find_object: "correlate",
  remember_object: "correlate",
  list_items: "correlate",
  get_item: "correlate",
  get_backlog: "correlate",
  daily_briefing: "correlate",
  act_on_item: "authority",
  escalate_item: "authority",
  prepare_payment: "authority",
  get_audit: "record",
  verify_ledger: "record",
  export_record: "record"
};

export function stageFor(toolName: string): StageId | undefined {
  return TOOL_STAGE[toolName];
}

export function stagesFor(calls: ReadonlyArray<{ name: string }>): StageId[] {
  const seen: StageId[] = [];
  for (const call of calls) {
    const stage = stageFor(call.name);
    if (stage && !seen.includes(stage)) seen.push(stage);
  }
  return seen;
}

export interface StageState {
  id: StageId;
  label: string;
  hint: string;
  status: "pending" | "current" | "done";
}

export function pipelineState(active: StageId | undefined): StageState[] {
  const activeIndex = active ? STAGES.findIndex((s) => s.id === active) : -1;
  return STAGES.map((stage, index) => ({
    ...stage,
    status: index < activeIndex ? "done" : index === activeIndex ? "current" : "pending"
  }));
}

export function revealSteps(text: string, chunk = 3): string[] {
  if (!text) return [""];
  const steps: string[] = [];
  for (let i = chunk; i < text.length; i += chunk) steps.push(text.slice(0, i));
  steps.push(text);
  return steps;
}
