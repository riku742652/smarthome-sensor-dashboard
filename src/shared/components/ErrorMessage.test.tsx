import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorMessage } from './ErrorMessage'

describe('ErrorMessage', () => {
  it('should render error message', () => {
    render(<ErrorMessage message="Something went wrong" />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('should render default error title', () => {
    render(<ErrorMessage message="Error details" />)

    expect(screen.getByText('エラーが発生しました')).toBeInTheDocument()
  })

  it('should render error icon', () => {
    const { container } = render(<ErrorMessage message="Error" />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should not render retry button when onRetry is not provided', () => {
    render(<ErrorMessage message="Error" />)

    expect(
      screen.queryByRole('button', { name: '再試行' })
    ).not.toBeInTheDocument()
  })

  it('should render retry button when onRetry is provided', () => {
    const onRetry = vi.fn()

    render(<ErrorMessage message="Error" onRetry={onRetry} />)

    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument()
  })

  it('should call onRetry when retry button is clicked', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()

    render(<ErrorMessage message="Error" onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: '再試行' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('should have correct styling classes for error state', () => {
    const { container } = render(<ErrorMessage message="Error" />)

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('bg-red-50')
  })

  it('should display long error messages', () => {
    const longMessage =
      'This is a very long error message that might span multiple lines and should be displayed correctly in the error component without breaking the layout'

    render(<ErrorMessage message={longMessage} />)

    expect(screen.getByText(longMessage)).toBeInTheDocument()
  })
})
