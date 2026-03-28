import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('should render children', () => {
    render(<Button>Click me</Button>)

    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('should handle click events', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button onClick={handleClick}>Click me</Button>)

    await user.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  describe('variants', () => {
    it('should apply primary variant styles by default', () => {
      render(<Button>Primary</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-blue-600')
    })

    it('should apply secondary variant styles', () => {
      render(<Button variant="secondary">Secondary</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-gray-200')
    })

    it('should apply ghost variant styles', () => {
      render(<Button variant="ghost">Ghost</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-transparent')
    })
  })

  describe('sizes', () => {
    it('should apply md size by default', () => {
      render(<Button>Medium</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-4', 'py-2')
    })

    it('should apply sm size', () => {
      render(<Button size="sm">Small</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-3', 'py-1.5')
    })

    it('should apply lg size', () => {
      render(<Button size="lg">Large</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-6', 'py-3')
    })
  })

  describe('loading state', () => {
    it('should show loading text when isLoading is true', () => {
      render(<Button isLoading>Submit</Button>)

      expect(screen.getByRole('button')).toHaveTextContent('Loading...')
      expect(screen.queryByText('Submit')).not.toBeInTheDocument()
    })

    it('should disable button when isLoading', () => {
      render(<Button isLoading>Submit</Button>)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should not trigger click when loading', async () => {
      const handleClick = vi.fn()
      const user = userEvent.setup()

      render(
        <Button isLoading onClick={handleClick}>
          Submit
        </Button>
      )

      await user.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should not trigger click when disabled', async () => {
      const handleClick = vi.fn()
      const user = userEvent.setup()

      render(
        <Button disabled onClick={handleClick}>
          Disabled
        </Button>
      )

      await user.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('className', () => {
    it('should merge custom className with default styles', () => {
      render(<Button className="custom-class">Custom</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
      expect(button).toHaveClass('rounded-lg') // Base style still applied
    })
  })

  describe('HTML attributes', () => {
    it('should forward type attribute', () => {
      render(<Button type="submit">Submit</Button>)

      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('should forward aria attributes', () => {
      render(<Button aria-label="Close">X</Button>)

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close')
    })

    it('should forward data attributes', () => {
      render(<Button data-testid="custom-button">Test</Button>)

      expect(screen.getByTestId('custom-button')).toBeInTheDocument()
    })
  })
})
