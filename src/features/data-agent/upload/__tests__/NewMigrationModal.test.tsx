import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn()
const invokeMock = vi.fn()
const schemaCacheData = [{ object_type: 'contact' }, { object_type: 'orders' }]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: (...args: unknown[]) => uploadMock(...args) }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: vi.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: schemaCacheData }) }) })),
  },
}))

import { NewMigrationModal } from '../NewMigrationModal'

describe('NewMigrationModal', () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null })
    invokeMock.mockReset().mockResolvedValue({ data: { migrationId: 'mig-1' }, error: null })
  })

  it('lists Contacts plus every cached Custom Object as target choices', async () => {
    render(<NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('option', { name: /contacts/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /orders/i })).toBeInTheDocument()
  })

  it('uploads the file to storage then calls data-agent-upload, and reports the new migration id', async () => {
    const onCreated = vi.fn()
    render(<NewMigrationModal subAccount="AM333" onCreated={onCreated} onClose={vi.fn()} />)
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
    invokeMock.mockResolvedValue({ data: null, error: { message: 'No schema cached yet' } })
    render(<NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} />)
    await screen.findByRole('option', { name: /orders/i })
    const file = new File(['Email\njane@x.com\n'], 'contacts.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText(/csv file/i), file)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No schema cached yet/i)
  })
})
