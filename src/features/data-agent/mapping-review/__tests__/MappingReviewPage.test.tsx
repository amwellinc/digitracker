import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const migrationRow = { id: 'mig-1', sub_account: 'AM333', connection_id: 'conn-1', target_object_type: 'contact', status: 'mapping', original_filename: 'contacts.csv', row_count: 2 }
let mappingRows: Record<string, unknown>[] = []
const updateMock = vi.fn()
const rpcMock = vi.fn()
// Lets a test inject a write failure — the mock's own .eq() resolution
// reads this, rather than always resolving { error: null }, so a test can
// actually exercise the "surface a remap write error" path.
let mappingUpdateError: { message: string } | null = null

vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'data_agent_migrations') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: migrationRow }) }) }),
          update: (...args: unknown[]) => { updateMock(...args); return { eq: () => Promise.resolve({ error: null }) } },
        }
      }
      if (table === 'data_agent_column_mappings') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mappingRows }) }) }),
          update: (...args: unknown[]) => { updateMock(...args); return { eq: () => Promise.resolve({ error: mappingUpdateError }) } },
        }
      }
      if (table === 'data_agent_connections') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { label: 'Acme Corp', ghl_location_id: 'loc_999' } }) }) }) }
      }
      // NOTE: the brief's own mock here only chained a single `.eq()` before
      // resolving to a Promise, but MappingReviewPage.tsx chains
      // `.eq('sub_account', ...).eq('object_type', ...)` against
      // `data_agent_ghl_schema_cache` — matching real Supabase query-builder
      // semantics, where each `.eq()` returns a further chainable/thenable
      // builder. The brief's mock and its own component code disagree here;
      // this adds the second `.eq()` level to the mock so it matches real
      // Supabase behavior, rather than weakening the component's query.
      return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ fields: [{ id: 'custom_notes_id', fieldKey: 'custom_notes', name: 'Notes', dataType: 'TEXT' }] }] }) }) }) }
    }),
  },
}))

import { MappingReviewPage } from '../MappingReviewPage'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/data-agent/migrations/${id}`]}>
      <Routes><Route path="/data-agent/migrations/:migrationId" element={<MappingReviewPage />} /></Routes>
    </MemoryRouter>
  )
}

describe('MappingReviewPage', () => {
  beforeEach(() => {
    updateMock.mockReset()
    rpcMock.mockReset().mockResolvedValue({ error: null })
    mappingUpdateError = null
    mappingRows = [
      { id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} },
      { id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} },
    ]
  })

  it('shows green for a mapped column and red for an unmapped one', async () => {
    renderAt('mig-1')
    expect(await screen.findByText('Email')).toBeInTheDocument()
    expect(screen.getByTestId('status-cm-1')).toHaveTextContent(/mapped/i)
    expect(screen.getByTestId('status-cm-2')).toHaveTextContent(/unmapped/i)
  })

  it('disables Confirm & Migrate while any column is still unresolved', async () => {
    renderAt('mig-1')
    await screen.findByText('Mystery')
    expect(screen.getByRole('button', { name: /confirm & migrate/i })).toBeDisabled()
  })

  it('choosing "Ignore this column" resolves it as mapped/ignored, not as still-red', async () => {
    renderAt('mig-1')
    await screen.findByText('Mystery')
    await userEvent.selectOptions(screen.getByLabelText(/map "Mystery" to/i), 'ignore')
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'mapped', target_type: 'ignored', target_field_key: null, mapped_by: 'user', confirmed_by_user: true,
    })))
  })

  it('REVIEW FINDING: lets the user remap to a real cached custom field, not just "ignore" — the dropdown must actually offer real, correctly-keyed options', async () => {
    mappingRows = [{ id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} }]
    renderAt('mig-1')
    const select = await screen.findByLabelText(/map "Mystery" to/i)
    expect(within(select).getByRole('option', { name: 'Notes' })).toHaveValue('custom_notes_id')
    await userEvent.selectOptions(select, 'custom_notes_id')
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'mapped', target_type: 'custom_field', target_field_key: 'custom_notes_id', mapped_by: 'user', confirmed_by_user: true,
    })))
  })

  it('REGRESSION: lets the user manually map a column as a tag, naming the tag before it saves', async () => {
    mappingRows = [{ id: 'cm-2', source_column_name: 'VIP Flag', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} }]
    renderAt('mig-1')
    const select = await screen.findByLabelText(/map "VIP Flag" to/i)
    await userEvent.selectOptions(select, 'tag')
    // Choosing "Tag…" must not save anything yet — it needs a tag name first.
    expect(updateMock).not.toHaveBeenCalled()
    const tagInput = screen.getByLabelText(/tag name for "VIP Flag"/i) as HTMLInputElement
    // Pre-filled from the column name as a reasonable starting point, editable.
    expect(tagInput.value).toBe('VIP Flag')
    await userEvent.clear(tagInput)
    await userEvent.type(tagInput, 'VIP Customer')
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'mapped', target_type: 'tag', target_field_key: 'VIP Customer', mapped_by: 'user', confirmed_by_user: true,
    })))
  })

  it('calls confirm_data_agent_migration when every column is resolved', async () => {
    mappingRows = [{ id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} }]
    renderAt('mig-1')
    const confirmBtn = await screen.findByRole('button', { name: /confirm & migrate/i })
    expect(confirmBtn).toBeEnabled()
    await userEvent.click(confirmBtn)
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('confirm_data_agent_migration', { p_migration_id: 'mig-1', p_default_country_code: null }))
  })

  it('shows a default-country-code input when a mapped phone column has absent/mixed country codes, and saves it before confirming', async () => {
    mappingRows = [{ id: 'cm-1', source_column_name: 'Phone', status: 'mapped', target_field_key: 'phone', target_type: 'standard_field', mapped_by: 'rule', metadata: { country_code_presence: 'mixed' } }]
    renderAt('mig-1')
    const input = await screen.findByLabelText(/default country code/i)
    await userEvent.type(input, '+65')
    await userEvent.click(screen.getByRole('button', { name: /confirm & migrate/i }))
    // There is no client UPDATE policy on data_agent_migrations (Task 7) —
    // the default country code must travel through the RPC parameter, not
    // a separate direct write, which would silently no-op under RLS.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('confirm_data_agent_migration', { p_migration_id: 'mig-1', p_default_country_code: '+65' }))
    expect(updateMock).not.toHaveBeenCalledWith({ default_country_code: '+65' })
  })

  it('does not pre-select "Ignore this column" for a genuinely unmapped column, even though classifyColumn also sets target_type "ignored" on its own no-match default', async () => {
    mappingRows = [{ id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} }]
    renderAt('mig-1')
    const select = await screen.findByLabelText(/map "Mystery" to/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('surfaces a remap write error instead of silently leaving the column unchanged', async () => {
    mappingRows = [{ id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} }]
    mappingUpdateError = { message: 'row-level security violation' }
    renderAt('mig-1')
    await userEvent.selectOptions(await screen.findByLabelText(/map "Mystery" to/i), 'ignore')
    expect(await screen.findByRole('alert')).toHaveTextContent(/row-level security violation/i)
  })

  it('submitting a prompt for a column calls data-agent-prompt and shows the response', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ data: { responseText: 'Mapped to Notes.' }, error: null })
    // `functions` is typed readonly on the real SupabaseClient; this mock
    // module is a plain object at runtime, so cast through `unknown` to
    // assign the test double without weakening the real client's type.
    ;(vi.mocked(await import('@/lib/supabase')).supabase as unknown as { functions: unknown }).functions = { invoke: invokeMock }
    renderAt('mig-1')
    await screen.findByText('Mystery')
    const promptInput = screen.getByLabelText(/ask about "Mystery"/i)
    await userEvent.type(promptInput, 'map this to notes')
    // Both rows render an "Ask" button, so scope the query to Mystery's
    // own row (the input's sibling container) rather than the ambiguous
    // page-wide getByRole, which would match Email's "Ask" button too.
    await userEvent.click(within(promptInput.parentElement as HTMLElement).getByRole('button', { name: /ask$/i }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('data-agent-prompt', {
      body: { migrationId: 'mig-1', columnMappingId: 'cm-2', promptText: 'map this to notes' },
    }))
    expect(await screen.findByText('Mapped to Notes.')).toBeInTheDocument()
  })

  it('shows an Undo button only once the migration has completed, and calls request_data_agent_undo', async () => {
    Object.assign(migrationRow, { status: 'completed' })
    mappingRows = [{ id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} }]
    renderAt('mig-1')
    const undoBtn = await screen.findByRole('button', { name: /undo migration/i })
    await userEvent.click(undoBtn)
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('request_data_agent_undo', { p_migration_id: 'mig-1' }))
  })

  it('REGRESSION: lets a stuck migration be cancelled — "cancelled" was a valid status with no way to ever reach it', async () => {
    Object.assign(migrationRow, { status: 'migrating' })
    renderAt('mig-1')
    const cancelBtn = await screen.findByRole('button', { name: /cancel migration/i })
    await userEvent.click(cancelBtn)
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('cancel_data_agent_migration', { p_migration_id: 'mig-1' }))
  })

  it('does not offer Cancel once a migration has already reached a terminal state', async () => {
    Object.assign(migrationRow, { status: 'completed' })
    mappingRows = [{ id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} }]
    renderAt('mig-1')
    await screen.findByRole('button', { name: /undo migration/i })
    expect(screen.queryByRole('button', { name: /cancel migration/i })).not.toBeInTheDocument()
  })

  it('REGRESSION: offers a manual Refresh for when nothing visibly progresses (e.g. the worker is stuck)', async () => {
    Object.assign(migrationRow, { status: 'migrating' })
    renderAt('mig-1')
    const refreshBtn = await screen.findByRole('button', { name: /^refresh$/i })
    await userEvent.click(refreshBtn)
    await waitFor(() => expect(refreshBtn).not.toBeDisabled())
  })

  it('does not show Undo while the migration is still in progress', async () => {
    Object.assign(migrationRow, { status: 'mapping' })
    renderAt('mig-1')
    await screen.findByText('Mystery')
    expect(screen.queryByRole('button', { name: /undo migration/i })).not.toBeInTheDocument()
  })
})
