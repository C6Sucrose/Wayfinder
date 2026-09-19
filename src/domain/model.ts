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

export const ItemSchema = z.object({
  itemId: z.string(),
  scanId: z.string(),
  class: DocClassSchema,
  confidence: z.number().min(0).max(1),
  readAloudText: z.string(),
  fields: FieldsSchema,
  proposedActions: z.array(ActionSchema),
  createdAt: z.string(),
  resolvedAt: z.string().nullable()
});
export type Item = z.infer<typeof ItemSchema>;

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
