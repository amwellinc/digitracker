import type { TargetField } from './dataAgentMatching.ts'
import type { AnthropicFetch } from './dataAgentClaude.ts'

export interface PromptContext {
  columnName: string
  sampleValues: string[]
  currentTargetFieldKey: string | null
  currentStatus: string
}

export type PromptAction = { target_field_key: string } | { ignore: true } | null
export interface PromptResult { responseText: string; action: PromptAction }

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5-5'

function buildPrompt(context: PromptContext, targetFields: TargetField[], userPrompt: string): string {
  return [
    'A user is reviewing one column of a CRM data migration mapping and has typed an instruction or question about it.',
    `Column: "${context.columnName}". Sample values: ${JSON.stringify(context.sampleValues)}.`,
    `Current mapping: ${context.currentTargetFieldKey ?? 'none'} (status: ${context.currentStatus}).`,
    'Target fields available (only ever reference one of these keys, never invent one):',
    JSON.stringify(targetFields.map(f => ({ key: f.key, label: f.label }))),
    `User instruction: "${userPrompt}"`,
    '',
    'Respond with ONLY JSON shaped exactly as:',
    '{"responseText": string, "action": null | {"target_field_key": string} | {"ignore": true}}',
    'Use action: null if this is just a question, or the instruction does not clearly resolve to one specific field or an explicit "ignore this column".',
  ].join('\n')
}

export async function resolvePrompt(
  context: PromptContext,
  targetFields: TargetField[],
  userPrompt: string,
  apiKey: string,
  fetchImpl: AnthropicFetch = fetch,
): Promise<PromptResult> {
  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: 'user', content: buildPrompt(context, targetFields, userPrompt) }] }),
  })
  if (!res.ok) throw new Error(`Claude prompt request failed: ${res.status} ${await res.text()}`)

  const body = await res.json() as { content: { type: string; text: string }[] }
  const text = body.content.find(c => c.type === 'text')?.text ?? '{"responseText":"","action":null}'
  const parsed = JSON.parse(text) as PromptResult

  const action = parsed.action
  if (action && 'target_field_key' in action) {
    const key = action.target_field_key
    if (!targetFields.some(f => f.key === key)) {
      return { responseText: parsed.responseText, action: null }
    }
  }
  return parsed
}
