export type DataAgentSourceSystem = 'salesforce' | 'hubspot' | null

export type DataAgentMigrationStatus =
  | 'uploaded' | 'mapping' | 'awaiting_confirmation' | 'migrating' | 'verifying'
  | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled' | 'undoing' | 'undone'

export type DataAgentMappingStatus = 'mapped' | 'uncertain' | 'unmapped'
export type DataAgentMappedBy = 'rule' | 'source_profile' | 'claude' | 'user'
export type DataAgentTargetType = 'standard_field' | 'custom_field' | 'tag' | 'ignored'
export type DataAgentWriteStatus = 'pending' | 'created' | 'replaced' | 'failed' | 'skipped'
export type DataAgentPhoneEmailSubtype = 'mobile' | 'home' | 'work' | 'fax' | 'other'
export type DataAgentDndChannel = 'call' | 'email' | 'sms'
export type DataAgentCountryCodePresence = 'present' | 'absent' | 'mixed'

export interface DataAgentColumnMappingMetadata {
  subtype?: DataAgentPhoneEmailSubtype
  dnd_channel?: DataAgentDndChannel
  country_code_presence?: DataAgentCountryCodePresence
  is_primary_candidate?: boolean
}

export interface DataAgentConnection {
  id: string
  sub_account: string
  label: string
  ghl_location_id: string
  last_verified_at: string | null
}

export interface DataAgentMigration {
  id: string
  sub_account: string
  connection_id: string | null
  created_by: string
  target_object_type: string
  source_system: DataAgentSourceSystem
  original_filename: string
  storage_path: string
  row_count: number
  match_key_column: string | null
  default_country_code: string | null
  status: DataAgentMigrationStatus
  accuracy_rating: number | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  created_at: string
}

export interface DataAgentColumnMapping {
  id: string
  migration_id: string
  source_column_name: string
  sample_values: string[]
  target_type: DataAgentTargetType
  target_field_key: string | null
  status: DataAgentMappingStatus
  confidence: number | null
  reasoning: string | null
  mapped_by: DataAgentMappedBy | null
  confirmed_by_user: boolean
  metadata: DataAgentColumnMappingMetadata
}

export interface DataAgentMigrationRecord {
  id: string
  migration_id: string
  row_number: number
  source_row_data: Record<string, string>
  ghl_record_id: string | null
  pre_replace_snapshot: Record<string, unknown> | null
  write_status: DataAgentWriteStatus
  error_message: string | null
  written_at: string | null
}

export interface DataAgentQaSample {
  id: string
  migration_record_id: string
  fetched_ghl_data: Record<string, unknown>
  field_comparisons: { field: string; expected: unknown; actual: unknown; match: boolean }[]
  match_pct: number
  created_at: string
}

export interface DataAgentChatMessage {
  id: string
  sub_account: string
  user_id: string
  message: string
  created_at: string
}
