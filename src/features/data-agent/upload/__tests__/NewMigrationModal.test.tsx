import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn()
const invokeMock = vi.fn()
const schemaCacheData = [{ object_type: 'contact' }, { object_type: 'orders' }]
// Mutable per-test so the "no connections yet" test can flip it without its
// own mock module — the default (one connection) keeps every other test's
// existing render path (straight to the upload form) unchanged.
let connectionRows: { id: string; sub_account: string; label: string; ghl_location_id: string; last_verified_at: string | null }[] =
  [{ id: 'conn-1', sub_account: 'AM333', label: 'Acme Corp', ghl_location_id: 'loc_999', last_verified_at: null }]

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1', sub_account: 'AM333', role: 'Admin' } }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: (...args: unknown[]) => uploadMock(...args) }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    // The modal lists data_agent_connections (via .order(), to populate
    // the account picker and decide whether to show the form at all)
    // separately from data_agent_ghl_schema_cache (via a bare .then(),
    // for the target dropdown's object types, keyed by the selected
    // connection) — the mock must route by table name.
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => {
          if (table === 'data_agent_connections') {
            return { order: () => Promise.resolve({ data: connectionRows }) }
          }
          return Promise.resolve({ data: schemaCacheData })
        },
      }),
    })),
  },
}))

import { NewMigrationModal } from '../NewMigrationModal'

describe('NewMigrationModal', () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null })
    invokeMock.mockReset().mockResolvedValue({ data: { migrationId: 'mig-1' }, error: null })
    connectionRows = [{ id: 'conn-1', sub_account: 'AM333', label: 'Acme Corp', ghl_location_id: 'loc_999', last_verified_at: null }]
  })

  it('shows a setup prompt instead of the upload form when no GHL connection exists yet', async () => {
    connectionRows = []
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} /></MemoryRouter>)
    expect(await screen.findByText(/isn.t connected to a GHL CRM/i)).toBeInTheDocument()
    // Connection setup now lives in Data Agent itself ("+ New Project" on
    // the folder list), not Settings — the modal just points an Admin
    // there instead of offering a dead /settings?tab=data-agent link.
    expect(screen.getByText(/\+ new project/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/csv file/i)).not.toBeInTheDocument()
  })

  it('REGRESSION: offers every connection as a choice when more than one exists, defaulting to the first', async () => {
    connectionRows = [
      { id: 'conn-1', sub_account: 'AM333', label: 'Client A', ghl_location_id: 'loc_a', last_verified_at: null },
      { id: 'conn-2', sub_account: 'AM333', label: 'Client B', ghl_location_id: 'loc_b', last_verified_at: null },
    ]
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} /></MemoryRouter>)
    const select = await screen.findByLabelText(/ghl account/i) as HTMLSelectElement
    expect(within(select).getByRole('option', { name: /client a/i })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /client b/i })).toBeInTheDocument()
    expect(select.value).toBe('conn-1')
  })

  it('lists Contacts plus every cached Custom Object as target choices', async () => {
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} /></MemoryRouter>)
    expect(await screen.findByRole('option', { name: /contacts/i })).toBeInTheDocument()
    // "Contacts" is a static option, rendered on the very first pass —
    // "orders" depends on a two-step async chain (connections resolve →
    // connectionId state updates → THEN the schema-cache query for that
    // connection fires), so it must be awaited with findByRole too rather
    // than asserted with a synchronous getByRole right after. Asserting
    // both with find/get back-to-back happened to pass by coincidental
    // microtask timing in isolation but was genuinely flaky — real evidence:
    // it failed consistently once other test files added enough overhead
    // to shift that timing.
    expect(await screen.findByRole('option', { name: /orders/i })).toBeInTheDocument()
  })

  it('uploads the file to storage then calls data-agent-upload with the selected connectionId, and reports the new migration id', async () => {
    const onCreated = vi.fn()
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={onCreated} onClose={vi.fn()} /></MemoryRouter>)
    await screen.findByRole('option', { name: /orders/i })
    await userEvent.selectOptions(screen.getByLabelText(/target/i), 'orders')
    const file = new File(['Email\njane@x.com\n'], 'contacts.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText(/csv file/i), file)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))

    await waitFor(() => expect(uploadMock).toHaveBeenCalled())
    const [path] = uploadMock.mock.calls[0]
    expect(path).toMatch(/^AM333\/.+-contacts\.csv$/)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('data-agent-upload', expect.objectContaining({
      body: expect.objectContaining({ subAccount: 'AM333', connectionId: 'conn-1', targetObjectType: 'orders', originalFilename: 'contacts.csv' }),
    })))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('mig-1'))
  })

  it('REGRESSION: passes free-text instructions to the agent through to data-agent-upload, trimmed, or null when left blank', async () => {
    const onCreated = vi.fn()
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={onCreated} onClose={vi.fn()} /></MemoryRouter>)
    await screen.findByRole('option', { name: /orders/i })
    await userEvent.type(screen.getByLabelText(/instructions for the agent/i), '  Tag these as the Spring Promo list  ')
    const file = new File(['Email\njane@x.com\n'], 'contacts.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText(/csv file/i), file)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('data-agent-upload', expect.objectContaining({
      body: expect.objectContaining({ instructions: 'Tag these as the Spring Promo list' }),
    })))
  })

  it('surfaces an upload-function error instead of claiming success', async () => {
    // The edge function returns HTTP 200 with { error } for a business
    // failure, not a thrown error — see data-agent-upload's own comment on
    // why (supabase-js discards a non-2xx response's real body).
    invokeMock.mockResolvedValue({ data: { error: 'No schema cached yet' }, error: null })
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} /></MemoryRouter>)
    await screen.findByRole('option', { name: /orders/i })
    const file = new File(['Email\njane@x.com\n'], 'contacts.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText(/csv file/i), file)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No schema cached yet/i)
  })
})
