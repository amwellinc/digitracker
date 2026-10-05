import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const membershipsMock = vi.fn()
vi.mock('@/hooks/useProjectMemberships', () => ({ useProjectMemberships: () => membershipsMock() }))
const exitViewAsMock = vi.fn()
const baseAuth = {
  user: { id: 'a1', name: 'Guest User', role: 'Associate' },
  signOut: vi.fn(),
  isSuperAdmin: false,
  viewAsUser: null as unknown,
  exitViewAs: exitViewAsMock,
}
let authValue: typeof baseAuth = baseAuth
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authValue }))
vi.mock('@/features/notifications/NotificationsBell', () => ({ NotificationsBell: () => <div>bell</div> }))

import { AssociateLayout } from '../AssociateLayout'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<AssociateLayout />}>
          <Route index element={<div>time tracking</div>} />
          <Route path="leave" element={<div>leave page</div>} />
          <Route path="projects/:projectId" element={<div>project page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AssociateLayout', () => {
  beforeEach(() => {
    membershipsMock.mockReset()
    exitViewAsMock.mockReset()
    authValue = baseAuth
  })

  it('shows only project entries in the sidebar', () => {
    membershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'AMUSA' }], loading: false })
    renderAt('/projects/p1')
    expect(screen.getByText('PROJECTS-AMUSA')).toBeInTheDocument()
    expect(screen.queryByText('Time Tracking')).not.toBeInTheDocument()
    expect(screen.getByText('project page')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exit view as/i })).not.toBeInTheDocument()
  })

  it('redirects any non-project route to the first project', () => {
    membershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'AMUSA' }], loading: false })
    renderAt('/leave')
    expect(screen.queryByText('leave page')).not.toBeInTheDocument()
    expect(screen.getByText('project page')).toBeInTheDocument()
  })

  it('shows the no-projects page when they have no projects', () => {
    membershipsMock.mockReturnValue({ memberships: [], loading: false })
    renderAt('/')
    expect(screen.queryByText('time tracking')).not.toBeInTheDocument()
    expect(screen.getByText(/haven't been added to a project yet/i)).toBeInTheDocument()
  })

  it('lets a Super-Admin viewing as an associate exit View As', () => {
    authValue = { ...baseAuth, isSuperAdmin: true, viewAsUser: { id: 'a1', name: 'Guest User', role: 'Associate' } }
    membershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'AMUSA' }], loading: false })
    renderAt('/projects/p1')
    fireEvent.click(screen.getByRole('button', { name: /exit view as/i }))
    expect(exitViewAsMock).toHaveBeenCalledTimes(1)
  })
})
