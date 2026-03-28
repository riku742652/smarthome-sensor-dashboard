import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('should render default message', () => {
    render(<EmptyState />)

    expect(screen.getByText('データがありません')).toBeInTheDocument()
  })

  it('should render custom message', () => {
    render(<EmptyState message="No data available" />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('should render description when provided', () => {
    render(
      <EmptyState
        message="No results"
        description="Try adjusting your filters"
      />
    )

    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument()
  })

  it('should not render description when not provided', () => {
    const { container } = render(<EmptyState message="No data" />)

    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1) // Only message, no description
  })

  it('should render SVG icon', () => {
    const { container } = render(<EmptyState />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should have correct styling classes', () => {
    const { container } = render(<EmptyState />)

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center')
  })
})
