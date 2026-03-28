import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('should render children', () => {
    render(
      <Card>
        <div>Card content</div>
      </Card>
    )

    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('should not render title section when title is not provided', () => {
    const { container } = render(
      <Card>
        <div>Content</div>
      </Card>
    )

    const heading = container.querySelector('h2')
    expect(heading).not.toBeInTheDocument()
  })

  it('should render title when provided', () => {
    render(
      <Card title="Test Title">
        <div>Content</div>
      </Card>
    )

    expect(screen.getByRole('heading', { name: 'Test Title' })).toBeInTheDocument()
  })

  it('should render subtitle when provided', () => {
    render(
      <Card title="Title" subtitle="Subtitle text">
        <div>Content</div>
      </Card>
    )

    expect(screen.getByText('Subtitle text')).toBeInTheDocument()
  })

  it('should not render subtitle when title is not provided', () => {
    render(
      <Card subtitle="Subtitle text">
        <div>Content</div>
      </Card>
    )

    // Subtitle should not render without title
    expect(screen.queryByText('Subtitle text')).not.toBeInTheDocument()
  })

  it('should render title without subtitle', () => {
    const { container } = render(
      <Card title="Only Title">
        <div>Content</div>
      </Card>
    )

    expect(screen.getByRole('heading', { name: 'Only Title' })).toBeInTheDocument()

    const subtitle = container.querySelector('.text-sm.text-gray-600')
    expect(subtitle).not.toBeInTheDocument()
  })

  it('should merge custom className with default styles', () => {
    const { container } = render(
      <Card className="custom-class">
        <div>Content</div>
      </Card>
    )

    const card = container.firstChild
    expect(card).toHaveClass('custom-class')
    expect(card).toHaveClass('bg-white', 'rounded-lg', 'shadow-md')
  })

  it('should have correct default styling', () => {
    const { container } = render(
      <Card>
        <div>Content</div>
      </Card>
    )

    const card = container.firstChild
    expect(card).toHaveClass('bg-white', 'rounded-lg', 'shadow-md', 'p-6')
  })

  it('should render multiple children', () => {
    render(
      <Card title="Multi-content">
        <div>First child</div>
        <div>Second child</div>
        <div>Third child</div>
      </Card>
    )

    expect(screen.getByText('First child')).toBeInTheDocument()
    expect(screen.getByText('Second child')).toBeInTheDocument()
    expect(screen.getByText('Third child')).toBeInTheDocument()
  })

  it('should render complex children', () => {
    render(
      <Card title="Complex Content">
        <div>
          <p>Paragraph 1</p>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      </Card>
    )

    expect(screen.getByText('Paragraph 1')).toBeInTheDocument()
    expect(screen.getByText('Item 1')).toBeInTheDocument()
    expect(screen.getByText('Item 2')).toBeInTheDocument()
  })
})
