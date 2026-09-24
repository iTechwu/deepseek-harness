/** Protocol-independent model capabilities and reasoning choices. */
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './types.ts'

const OFF_REASONING_EFFORT = ReasoningEffortId('off')
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')
const REASONING_EFFORTS = [
  {
    id: OFF_REASONING_EFFORT,
    name: 'Off',
    description: 'Use for simple tasks that do not need reasoning.',
  },
  {
    id: LOW_REASONING_EFFORT,
    name: 'Low',
    description: 'Prefer for routine or latency-sensitive tasks.',
  },
  {
    id: HIGH_REASONING_EFFORT,
    name: 'High',
    description: 'The default balance for most tasks.',
  },
  {
    id: MAX_REASONING_EFFORT,
    name: 'Max',
    description: 'Reserve for the hardest quality-first tasks.',
  },
] as const
const OFF_ONLY_REASONING_EFFORTS = [
  {
    id: OFF_REASONING_EFFORT,
    name: 'Off',
    description: 'Use for simple tasks that do not need reasoning.',
  },
] as const

/** Advertise one catalog entry.
 * @param provider - registered provider id.
 * @param model - advisory catalog entry.
 * @returns selector metadata.
 */
export function catalogModelInfo(provider: string, model: DeepSeekCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: model.inputModalities ?? ['text'],
  }
}

/** Public DoFe/Z.AI GLM-5.3 endpoints accept at most 128K generated tokens. */
const GLM_53_MAX_TOKENS = 131_072
const GLM_53_MODEL_PATTERN = /^glm-5\.3(?:-flash)?$/iu

/** Wire cap for one model id: GLM-5.3 endpoints clamp every fallback to 128K generated tokens. */
export function modelMaxTokens(model: string, fallback: number): number {
  return GLM_53_MODEL_PATTERN.test(model) ? Math.min(fallback, GLM_53_MAX_TOKENS) : fallback
}

/** Effective per-request output cap: request value, else the model or connection default,
 * GLM-clamped, then bounded by the catalog model's own cap. */
export function resolveRequestMaxTokens(
  model: string,
  requested: number | undefined,
  configured: DeepSeekCatalogModel | undefined,
  connectionMaxTokens: number,
): number {
  const requestedMaxTokens = requested ?? configured?.maxTokens ?? connectionMaxTokens
  return Math.min(modelMaxTokens(model, requestedMaxTokens), configured?.maxTokens ?? Number.MAX_SAFE_INTEGER)
}

/** Resolve model capabilities against one configuration generation.
 * @param connection - validated connection facts.
 * @param provider - registered provider id.
 * @param model - requested wire model id.
 * @returns effective model metadata for this operation.
 */
export function modelInfo(
  connection: DeepSeekConnectionOptions,
  provider: string,
  model: string,
): LlmResolvedModelInfo {
  const configured = connection.models.find(entry => entry.id === model)
  const contextWindow = configured?.contextWindow
    ?? connection.defaultContextWindow
  return {
    // An uncatalogued endpoint is safely treated as text-only. Declaring an
    // unverified image capability would let the host persist input that the
    // endpoint may reject on every later turn.
    ...configured === undefined
      ? { provider, id: model, name: model, inputModalities: ['text' as const] }
      : catalogModelInfo(provider, configured),
    context: { contextWindow },
    defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
    ...configured?.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: configured.systemPromptUpdate },
    ...connection.defaults.thinking === 'disabled'
      ? {
        reasoning: {
          efforts: OFF_ONLY_REASONING_EFFORTS,
          defaultEffort: OFF_REASONING_EFFORT,
        },
      }
      : {
        reasoning: {
          efforts: REASONING_EFFORTS,
          defaultEffort: connection.defaults.reasoningEffort === 'off'
            ? OFF_REASONING_EFFORT
            : connection.defaults.reasoningEffort === 'low'
              ? LOW_REASONING_EFFORT
              : connection.defaults.reasoningEffort === 'max'
                ? MAX_REASONING_EFFORT
                : HIGH_REASONING_EFFORT,
        },
      },
  }
}
