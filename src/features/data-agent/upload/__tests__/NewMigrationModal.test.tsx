import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn()
const invokeMock = vi.fn()
const schemaCacheData = [{ object_type: 'contact' }, { object_type: 'orders' }]
// Mutable per-test so the "no connection yet" test can flip it without its
// own mock module — the default (truthy) keeps every other test's existing
// render path (straight to the upload form) unchanged.
let connectionRow: { sub_account: string } | null = { sub_account: 'AM333' }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: (...args: unknown[]) => uploadMock(...args) }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    // The modal checks data_agent_connections (via .maybeSingle(), to
    // decide whether to show the form at all) separately from
    // data_agent_ghl_schema_cache (via a bare .then(), for the target
    // dropdown's object types) — the mock must route by table name and
    // support both chain shapes.
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => {
          if (table === 'data_agent_connections') {
            return { maybeSingle: () => Promise.resolve({ data: connectionRow }) }
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
    connectionRow = { sub_account: 'AM333' }
  })

  it('shows a setup prompt instead of the upload form when no GHL connection exists yet', async () => {
    connectionRow = null
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} /></MemoryRouter>)
    expect(await screen.findByText(/isn.t connected to a GHL CRM/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to settings/i })).toHaveAttribute('href', '/settings?tab=data-agent')
    expect(screen.queryByLabelText(/csv file/i)).not.toBeInTheDocument()
  })

  it('lists Contacts plus every cached Custom Object as target choices', async () => {
    render(<MemoryRouter><NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} /></MemoryRouter>)
    expect(await screen.findByRole('option', { name: /contacts/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /orders/i })).toBeInTheDocument()
  })

  it('uploads the file to storage then calls data-agent-upload, and reports the new migration id', async () => {
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
      body: expect.objectContaining({ subAccount: 'AM333', targetObjectType: 'orders', originalFilename: 'contacts.csv' }),
    })))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('mig-1'))
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
