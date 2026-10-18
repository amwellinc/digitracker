import type { PlannedColumnMapping } from '../_shared/dataAgentUploadPlanner.ts'
import { proposeMappingsWithClaude, type AnthropicFetch } from '../_shared/dataAgentClaude.ts'
import type { TargetField, ColumnClassificationMetadata } from '../_shared/dataAgentMatching.ts'

export async function planWithClaude(
  rulesPlan: PlannedColumnMapping[],
  targetFields: TargetField[],
  sourceSystem: 'salesforce' | 'hubspot' | null,
  apiKey: string,
  fetchImpl?: AnthropicFetch,
): Promise<PlannedColumnMapping[]> {
  const unmapped = rulesPlan.filter(p => p.status === 'unmapped')
  if (unmapped.length === 0) return rulesPlan

  const proposals = await proposeMappingsWithClaude(
    unmapped.map(p => ({ columnName: p.source_column_name, sampleValues: p.sample_values })),
    targetFields, sourceSystem, apiKey, fetchImpl,
  )
  const proposalByColumn = new Map(proposals.map(p => [p.source_column_name, p]))

  return rulesPlan.map(p => {
    const proposal = proposalByColumn.get(p.source_column_name)
    if (!proposal || p.status !== 'unmapped') return p
    if (proposal.target_field_key === null) {
      // Claude also declined — stays red, with its reasoning kept for display.
      return { ...p, reasoning: proposal.reasoning }
    }
    const field = targetFields.find(f => f.key === proposal.target_field_key)
    return {
      ...p,
      status: 'uncertain', mapped_by: 'claude',
      target_field_key: proposal.target_field_key,
      target_type: field?.type === 'standard' ? 'standard_field' : 'custom_field',
      confidence: proposal.confidence, reasoning: proposal.reasoning,
      // proposal.metadata's fields are typed as plain `string` in
      // dataAgentClaude.ts (Task 11) since Claude's output is never
      // statically guaranteed, but the prompt there constrains Claude to
      // the same literal values ColumnClassificationMetadata expects.
      metadata: { ...p.metadata, ...proposal.metadata } as ColumnClassificationMetadata,
    }
  })
}
