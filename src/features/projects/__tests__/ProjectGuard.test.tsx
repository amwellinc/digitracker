import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectGuard } from '../ProjectGuard'

const useProjectMembershipsMock = vi.fn()
vi.mock('@/hooks/useProjectMemberships', () => ({
  useProjectMemberships: () => useProjectMembershipsMock(),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route
          path="/projects/:projectId"
          element={<ProjectGuard><div>project content</div></ProjectGuard>}
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProjectGuard', () => {
  it('shows a spinner while memberships are loading', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [], loading: true })
    const { container } = renderAt('/projects/p1')
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders children when the user is a member of this project', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'JohnBakery' }], loading: false })
    renderAt('/projects/p1')
    expect(screen.getByText('project content')).toBeInTheDocument()
  })

  it('redirects to / when the user is not a member of this project', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [{ id: 'p2', name: 'AcmeCorp' }], loading: false })
    renderAt('/projects/p1')
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
