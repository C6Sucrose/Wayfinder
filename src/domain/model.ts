import { z } from "zod";

export const DocClassSchema = z.enum([
  "bill", "appointment", "insurance", "government",
  "receipt", "personal", "junk", "scam", "label"
]);
export type DocClass = z.infer<typeof DocClassSchema>;

export const ActionTypeSchema = z.enum([
  "remind", "schedule", "flag", "file", "share", "discard"
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionStatusSchema = z.enum(["proposed", "confirmed", "done", "failed"]);

export const FieldsSchema = z.object({
  sender: z.string().optional(),
  dueDate: z.string().optional(),
  amount: z.object({ value: z.number(), currency: z.string() }).optional(),
  appointmentAt: z.string().optional(),
  reference: z.string().optional(),
  actionRequired: z.string().optional(),
  maskedAccount: z.string().optional()
}).strict();
export type Fields = z.infer<typeof FieldsSchema>;

export const ActionSchema = z.object({
  actionId: z.string(),
  itemId: z.string(),
  type: ActionTypeSchema,
  params: z.record(z.unknown()).default({}),
  status: ActionStatusSchema
});
export type Action = z.infer<typeof ActionSchema>;

export const LifecycleSchema = z.enum(["open", "awaiting_action", "action_taken", "confirmed", "closed", "escalated"]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const DemandSchema = z.object({
  type: z.enum(["payment", "reply", "appointment"]),
  deadline: z.string().optional()
});
export type Demand = z.infer<typeof DemandSchema>;

export const DocumentStateSchema = z.object({
  lifecycle: LifecycleSchema,
  confidence: z.enum(["high", "low"]),
  needsRecapture: z.boolean(),
  demands: z.array(DemandSchema),
  threadKey: z.string(),
  supersedes: z.string().optional(),
  supersededBy: z.string().optional(),
  confirmation: z.object({ at: z.string(), detail: z.string(), artifact: z.string().optional() }).optional()
});
export type DocumentState = z.infer<typeof DocumentStateSchema>;

export const ItemSchema = z.object({
  itemId: z.string(),
  scanId: z.string(),
  class: DocClassSchema,
  confidence: z.number().min(0).max(1),
  readAloudText: z.string(),
  fields: FieldsSchema,
  proposedActions: z.array(ActionSchema),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  record: DocumentStateSchema.optional()
});
export type Item = z.infer<typeof ItemSchema>;

export interface DocumentRecord extends Item {
  record: DocumentState;
}

export const ScanSchema = z.object({
  scanId: z.string(),
  hint: z.enum(["mail", "label", "object", "scene", "auto"]),
  imageRefs: z.array(z.string()),
  status: z.enum(["queued", "analyzing", "ready", "failed"]),
  createdAt: z.string()
});
export type Scan = z.infer<typeof ScanSchema>;

export const StoredObjectSchema = z.object({
  objectId: z.string(),
  name: z.string(),
  locationNote: z.string(),
  lastSeenAt: z.string(),
  imageRef: z.string().optional()
});
export type StoredObject = z.infer<typeof StoredObjectSchema>;

export const PreferencesSchema = z.object({
  verbosity: z.enum(["brief", "normal", "detailed"]).default("normal"),
  trustedContactAlias: z.string().nullable().default(null),
  largeText: z.boolean().default(false),
  locale: z.string().default("en-US")
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const LedgerEventSchema = z.enum([
  "ingested", "triaged", "action_proposed", "action_confirmed", "action_refused",
  "delivery_failed", "superseded", "flag_raised", "escalated", "closed"
]);
export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

export const LedgerEntrySchema = z.object({
  seq: z.number().int().positive(),
  entryId: z.string(),
  at: z.string(),
  actor: z.enum(["agent", "user"]),
  event: LedgerEventSchema,
  documentId: z.string().optional(),
  threadKey: z.string().optional(),
  details: z.record(z.unknown()),
  prevHash: z.string(),
  hash: z.string()
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const ThreadSchema = z.object({
  threadKey: z.string(),
  sender: z.string(),
  demandType: z.string(),
  documentIds: z.array(z.string()),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  reminderCount: z.number().int().nonnegative(),
  urgency: z.enum(["low", "medium", "high"]),
  outstanding: z.boolean()
});
export type Thread = z.infer<typeof ThreadSchema>;

export const AuthoritySchema = z.object({
  autoActUpTo: z.object({ currency: z.string(), value: z.number().nonnegative() }),
  confirmAbove: z.object({ currency: z.string(), value: z.number().nonnegative() }),
  forbidden: z.array(z.enum(["make_payment", "share_personal_data", "delete_document", "discard_document"])),
  onLowConfidence: z.enum(["ask", "refuse", "escalate"])
}).refine((a) => a.confirmAbove.value <= a.autoActUpTo.value, {
  message: "confirmAbove must not exceed autoActUpTo"
});
export type Authority = z.infer<typeof AuthoritySchema>;
