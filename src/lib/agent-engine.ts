import { z } from "zod";
import {
  modelOutputSchema,
  type ModelOutput,
  type RunInput,
} from "./agent-contracts";
import type { Citation } from "./knowledge";
export class RunFailure extends Error {}
export type Usage = {
  engine: string;
  kind: "unknown" | "not_applicable" | "reported";
  inputTokens: number | null;
  outputTokens: number | null;
  costMicrousd: number | null;
};
export type DraftContext = {
  instructions: string;
  operation: "source_brief" | "message_draft";
  input: RunInput;
  sources: Citation[];
};
export type Engine = {
  id: string;
  local: boolean;
  pricing: { inputPerMillion: number; outputPerMillion: number };
  generate: (
    context: DraftContext,
    signal: AbortSignal,
  ) => Promise<{ text: string; usage: unknown }>;
};
export const localEngine: Engine = {
  id: "local-excerpts-v1",
  local: true,
  pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  async generate(context, signal) {
    signal.throwIfAborted();
    const draft = [
      "Objective: " + context.input.objective,
      "Context: " + context.input.context,
      "Procedure instructions (for human review):",
      context.instructions,
      "Reference excerpts:",
      ...context.sources.map(
        (source, index) => "[" + (index + 1) + "] " + source.quote,
      ),
    ]
      .join("\n\n")
      .slice(0, 6000);
    return {
      text: JSON.stringify({
        summary:
          "Local source-backed draft for human review; no model inference or action execution.",
        draft,
        citations: context.sources.map((source) => ({
          documentId: source.documentId,
          chunk: source.chunk,
        })),
        proposals:
          context.operation === "message_draft"
            ? [
                {
                  kind: "send_message",
                  target:
                    context.input.target ||
                    "Recipient must be selected by a human",
                  payload: draft,
                },
              ]
            : [],
      }),
      usage: null,
    };
  },
};
export function emptyUsage(engine: Engine): Usage {
  return {
    engine: engine.id,
    kind: engine.local ? "not_applicable" : "unknown",
    inputTokens: engine.local ? 0 : null,
    outputTokens: engine.local ? 0 : null,
    costMicrousd: engine.local ? 0 : null,
  };
}
export function measuredUsage(engine: Engine, value: unknown): Usage {
  if (engine.local) return emptyUsage(engine);
  const result = z
    .object({
      inputTokens: z.number().int().min(0).max(10000000),
      outputTokens: z.number().int().min(0).max(10000000),
    })
    .strict()
    .safeParse(value);
  const rates = z
    .object({
      inputPerMillion: z.number().int().min(0).max(1000000000),
      outputPerMillion: z.number().int().min(0).max(1000000000),
    })
    .strict()
    .safeParse(engine.pricing);
  if (!result.success || !rates.success) throw new RunFailure("invalid_usage");
  const { inputTokens, outputTokens } = result.data;
  const numerator =
    BigInt(inputTokens) * BigInt(rates.data.inputPerMillion) +
    BigInt(outputTokens) * BigInt(rates.data.outputPerMillion);
  const costMicrousd = Number((numerator + 999999n) / 1000000n);
  return {
    engine: engine.id,
    kind: "reported",
    inputTokens,
    outputTokens,
    costMicrousd,
  };
}
export function enforceBudget(
  usage: Usage,
  maxTokens: number,
  maxCost: number,
) {
  if (usage.kind === "unknown") throw new RunFailure("invalid_usage");
  if (
    (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) > maxTokens ||
    (usage.costMicrousd ?? 0) > maxCost
  )
    throw new RunFailure("budget_exceeded");
}
export function validateDraft(text: unknown, sources: Citation[]): ModelOutput {
  if (typeof text !== "string" || Buffer.byteLength(text) > 32000)
    throw new RunFailure("malformed_output");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RunFailure("malformed_output");
  }
  const parsed = modelOutputSchema.safeParse(value);
  if (!parsed.success) throw new RunFailure("malformed_output");
  const keys = new Set(
    sources.map((source) => source.documentId + ":" + source.chunk),
  );
  if (
    parsed.data.citations.some(
      (cite) => !keys.has(cite.documentId + ":" + cite.chunk),
    ) ||
    new Set(parsed.data.citations.map((c) => c.documentId + ":" + c.chunk))
      .size !== parsed.data.citations.length
  )
    throw new RunFailure("invalid_citations");
  return parsed.data;
}
export function enforceDraftPolicy(
  output: ModelOutput,
  operation: DraftContext["operation"],
) {
  if (
    output.proposals.some(
      (proposal) =>
        operation !== "message_draft" || proposal.kind !== "send_message",
    )
  )
    throw new RunFailure("malformed_output");
  return {
    ...output,
    proposals: output.proposals.map((proposal) => ({
      ...proposal,
      approvalRequired: true as const,
      executionAllowed: false as const,
      state: "blocked" as const,
      reason:
        "Request approval to review the exact action. Approved actions are recorded only in the local outbox.",
    })),
  };
}
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RunFailure("timeout"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
