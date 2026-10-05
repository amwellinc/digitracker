import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const signedUrlMock = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('../projectFiles', async (orig) => ({
  ...(await orig<typeof import('../projectFiles')>()),
  signedUrl: (...a: unknown[]) => signedUrlMock(...a),
}))

import { AttachmentLink } from '../AttachmentLink'

describe('AttachmentLink', () => {
  let fakeWin: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    signedUrlMock.mockReset()
    fakeWin = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockImplementation(() => fakeWin as unknown as Window)
  })

  it('signs bucket+path fresh on click and opens it', async () => {
    signedUrlMock.mockResolvedValue('https://fresh')
    render(<AttachmentLink attachment={{ bucket: 'project-files', path: 'p1/x/a.pdf', name: 'a.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /a\.pdf/ }))
    expect(signedUrlMock).toHaveBeenCalledWith('project-files', 'p1/x/a.pdf')
    expect(vi.mocked(window.open).mock.calls[0]).toEqual(['', '_blank'])
    expect(fakeWin.opener).toBeNull()
    expect(fakeWin.location.href).toBe('https://fresh')
  })

  it('re-signs a legacy expired link from its path', async () => {
    signedUrlMock.mockResolvedValue('https://fresh2')
    const url = 'https://x.supabase.co/storage/v1/object/sign/task-attachments/t1/old.pdf?token=expired'
    render(<AttachmentLink attachment={{ url, name: 'old.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /old\.pdf/ }))
    expect(signedUrlMock).toHaveBeenCalledWith('task-attachments', 't1/old.pdf')
  })

  it('shows an error when the file cannot be opened', async () => {
    signedUrlMock.mockResolvedValue(null)
    render(<AttachmentLink attachment={{ bucket: 'project-files', path: 'p1/x/gone.pdf', name: 'gone.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /gone\.pdf/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not open/i)
    expect(fakeWin.close).toHaveBeenCalled()
  })

  it('falls back to a noopener open when the sync popup is blocked', async () => {
    vi.mocked(window.open).mockReset().mockReturnValueOnce(null).mockReturnValue(null)
    signedUrlMock.mockResolvedValue('https://fresh3')
    render(<AttachmentLink attachment={{ bucket: 'project-files', path: 'p1/x/b.pdf', name: 'b.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /b\.pdf/ }))
    expect(window.open).toHaveBeenLastCalledWith('https://fresh3', '_blank', 'noopener')
  })
})
