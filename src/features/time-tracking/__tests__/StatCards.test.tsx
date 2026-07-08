import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { StatCards } from '../StatCards'

const base = {
  status: 'clocked_out' as const,
  dayMinutes: 0,
  liveSeconds: 0,
  isCapturing: false,
  isWorking: false,
  isOnLunch: false,
  onClockIn: vi.fn(),
  onStartLunch: vi.fn(),
  onEndLunch: vi.fn(),
  onClockOut: vi.fn(),
}

describe('StatCards', () => {
  it('shows Clock In when clocked out', () => {
    render(<StatCards {...base} />)
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument()
  })

  it('calls onClockIn when clicked', async () => {
    const onClockIn = vi.fn()
    render(<StatCards {...base} onClockIn={onClockIn} />)
    await userEvent.click(screen.getByRole('button', { name: /clock in/i }))
    expect(onClockIn).toHaveBeenCalledOnce()
  })

  it('shows Start Lunch + Clock Out when working', () => {
    render(<StatCards {...base} status="working" isWorking={true} />)
    expect(screen.getByRole('button', { name: /start lunch/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clock out/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clock in/i })).not.toBeInTheDocument()
  })

  it('shows End Lunch + Clock Out when on lunch', () => {
    render(<StatCards {...base} status="lunch" isOnLunch={true} />)
    expect(screen.getByRole('button', { name: /end lunch/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clock out/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start lunch/i })).not.toBeInTheDocument()
  })

  it('formats 167 minutes as 02:47:00', () => {
    render(<StatCards {...base} dayMinutes={167} />)
    expect(screen.getByText('02:47:00')).toBeInTheDocument()
  })

  it('shows capture indicator when capturing', () => {
    render(<StatCards {...base} isCapturing={true} />)
    expect(screen.getByText(/screen capture active/i)).toBeInTheDocument()
  })
})
