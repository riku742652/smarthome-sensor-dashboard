import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimeRangeSelector } from './TimeRangeSelector'
import type { TimeRange } from '@domains/dashboard/types'

describe('TimeRangeSelector', () => {
  it('should render all time range options', () => {
    const onChange = vi.fn()

    render(<TimeRangeSelector selectedRange="24h" onChange={onChange} />)

    expect(screen.getByRole('button', { name: '1時間' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6時間' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '12時間' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '24時間' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7日間' })).toBeInTheDocument()
  })

  it('should highlight selected range', () => {
    const onChange = vi.fn()

    render(<TimeRangeSelector selectedRange="6h" onChange={onChange} />)

    const selectedButton = screen.getByRole('button', { name: '6時間' })
    expect(selectedButton).toHaveClass('bg-blue-600', 'text-white')
  })

  it('should apply default styles to non-selected ranges', () => {
    const onChange = vi.fn()

    render(<TimeRangeSelector selectedRange="24h" onChange={onChange} />)

    const nonSelectedButton = screen.getByRole('button', { name: '1時間' })
    expect(nonSelectedButton).toHaveClass('bg-gray-200', 'text-gray-700')
  })

  it('should call onChange when a range is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<TimeRangeSelector selectedRange="24h" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '6時間' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('6h')
  })

  it('should call onChange with correct value for each range', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<TimeRangeSelector selectedRange="24h" onChange={onChange} />)

    const testCases: Array<{ label: string; value: TimeRange }> = [
      { label: '1時間', value: '1h' },
      { label: '6時間', value: '6h' },
      { label: '12時間', value: '12h' },
      { label: '24時間', value: '24h' },
      { label: '7日間', value: '7d' },
    ]

    for (const { label, value } of testCases) {
      onChange.mockClear()
      await user.click(screen.getByRole('button', { name: label }))
      expect(onChange).toHaveBeenCalledWith(value)
    }
  })

  it('should allow clicking the currently selected range', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(<TimeRangeSelector selectedRange="24h" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '24時間' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('24h')
  })

  it('should render buttons in correct order', () => {
    const onChange = vi.fn()

    render(<TimeRangeSelector selectedRange="24h" onChange={onChange} />)

    const buttons = screen.getAllByRole('button')

    expect(buttons[0]).toHaveTextContent('1時間')
    expect(buttons[1]).toHaveTextContent('6時間')
    expect(buttons[2]).toHaveTextContent('12時間')
    expect(buttons[3]).toHaveTextContent('24時間')
    expect(buttons[4]).toHaveTextContent('7日間')
  })

  it('should update selection when selectedRange prop changes', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <TimeRangeSelector selectedRange="1h" onChange={onChange} />
    )

    expect(screen.getByRole('button', { name: '1時間' })).toHaveClass(
      'bg-blue-600'
    )

    rerender(<TimeRangeSelector selectedRange="7d" onChange={onChange} />)

    expect(screen.getByRole('button', { name: '7日間' })).toHaveClass(
      'bg-blue-600'
    )
    expect(screen.getByRole('button', { name: '1時間' })).toHaveClass(
      'bg-gray-200'
    )
  })
})
