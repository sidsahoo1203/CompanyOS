import { z } from "zod";
export const runInputSchema = z
  .object({
    objective: z.string().trim().min(2).max(500),
    context: z.string().trim().max(2000).default(""),
    target: z.string().trim().max(200).default(""),
  })
  .strict();
export const proposalSchema = z
  .object({
    kind: z.enum(["send_message", "update_record"]),
    target: z.string().min(1).max(200),
    payload: z.string().min(1).max(6000),
  })
  .strict();
export const modelOutputSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    draft: z.string().min(1).max(10000),
    citations: z
      .array(
        z
          .object({
            documentId: z.uuid(),
            chunk: z.number().int().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    proposals: z.array(proposalSchema).max(3),
  })
  .strict();
export const procedureSchema = z
  .object({
    procedureId: z.uuid().nullable().default(null),
    title: z.string().trim().min(2).max(120),
    instructions: z.string().trim().min(10).max(6000),
    sourceIds: z
      .array(z.uuid())
      .min(1)
      .max(8)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Choose each source once.",
      ),
  })
  .strict();
export const skillSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    versionId: z.uuid(),
    operation: z.enum(["source_brief", "message_draft"]),
    maxTokens: z.number().int().min(128).max(16000).default(8000),
    maxCostMicrousd: z.number().int().min(0).max(1000000).default(0),
    timeoutMs: z.number().int().min(1000).max(15000).default(10000),
  })
  .strict();
export const startRunSchema = z
  .object({ skillId: z.uuid(), requestKey: z.uuid(), input: runInputSchema })
  .strict();
export type RunInput = z.infer<typeof runInputSchema>;
export type ProcedureInput = z.infer<typeof procedureSchema>;
export type SkillInput = z.infer<typeof skillSchema>;
export type ModelOutput = z.infer<typeof modelOutputSchema>;
export const inputContract = z.toJSONSchema(runInputSchema);
export const outputContract = z.toJSONSchema(modelOutputSchema);
export const runMessages: Record<string, string> = {
  missing_sources:
    "Required knowledge is missing, archived, inaccessible, or not ready. Restore access and ready documents, then create a new run.",
  malformed_output:
    "The drafting engine returned an invalid result. No draft or action was accepted.",
  invalid_citations:
    "The result cited material outside the authorized source set. No draft was accepted.",
  timeout:
    "The run exceeded its deadline. No action was executed. Create a new run to retry.",
  budget_exceeded:
    "The token or cost budget was exceeded. No draft was accepted.",
  invalid_usage: "Usage could not be validated. No draft was accepted.",
  engine_failed: "The drafting engine failed. No action was executed.",
  access_changed: "Access changed during this run. No result was released.",
};
