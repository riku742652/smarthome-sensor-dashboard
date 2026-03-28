import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Loading } from './Loading'

describe('Loading', () => {
  it('should render default message', () => {
    render(<Loading />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('should render custom message', () => {
    render(<Loading message="Please wait" />)

    expect(screen.getByText('Please wait')).toBeInTheDocument()
  })

  it('should not render message when empty string is provided', () => {
    render(<Loading message="" />)

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  })

  it('should render spinner', () => {
    const { container } = render(<Loading />)

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  describe('sizes', () => {
    it('should apply md size by default', () => {
      const { container } = render(<Loading />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toHaveClass('w-12', 'h-12')
    })

    it('should apply sm size', () => {
      const { container } = render(<Loading size="sm" />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toHaveClass('w-8', 'h-8')
    })

    it('should apply lg size', () => {
      const { container } = render(<Loading size="lg" />)

      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toHaveClass('w-16', 'h-16')
    })
  })

  it('should have correct styling classes', () => {
    const { container } = render(<Loading />)

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center')
  })

  it('should have spinner with correct color classes', () => {
    const { container } = render(<Loading />)

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toHaveClass('border-blue-200', 'border-t-blue-600')
  })
})
