import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RecentScreenshots } from '../RecentScreenshots'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { id: '1', user_id: 'u1', url: 'http://x.com/1.jpg', timestamp: '2026-07-08T10:00:00Z', date: '2026-07-08' },
          { id: '2', user_id: 'u1', url: 'http://x.com/2.jpg', timestamp: '2026-07-08T10:15:00Z', date: '2026-07-08' },
        ],
      }),
    }),
  },
}))

describe('RecentScreenshots', () => {
  it('shows empty state when userId is empty', () => {
    render(<RecentScreenshots userId="" />)
    expect(screen.getByText(/no screenshots yet/i)).toBeInTheDocument()
  })

  it('renders screenshot thumbnails', async () => {
    render(<RecentScreenshots userId="u1" />)
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
  })
})
