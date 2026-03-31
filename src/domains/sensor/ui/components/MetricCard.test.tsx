import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCard } from './MetricCard'

describe('MetricCard', () => {
  it('should render label, value, and unit', () => {
    render(
      <MetricCard
        label="Temperature"
        value={25.5}
        unit="°C"
        color="#ef4444"
      />
    )

    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('25.5')).toBeInTheDocument()
    expect(screen.getByText('°C')).toBeInTheDocument()
  })

  it('should format value to 1 decimal place', () => {
    render(
      <MetricCard
        label="Humidity"
        value={60.123456}
        unit="%"
        color="#3b82f6"
      />
    )

    expect(screen.getByText('60.1')).toBeInTheDocument()
  })

  it('should apply color to value', () => {
    render(
      <MetricCard
        label="CO2"
        value={800}
        unit="ppm"
        color="#10b981"
      />
    )

    const valueElement = screen.getByText('800.0')
    expect(valueElement).toHaveStyle({ color: '#10b981' })
  })

  it('should render icon when provided', () => {
    const icon = <div data-testid="test-icon">Icon</div>

    render(
      <MetricCard
        label="Test"
        value={42}
        unit="unit"
        color="#000000"
        icon={icon}
      />
    )

    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })

  it('should not render icon when not provided', () => {
    const { container } = render(
      <MetricCard
        label="Test"
        value={42}
        unit="unit"
        color="#000000"
      />
    )

    // Check that no icon div is rendered
    const iconContainer = container.querySelector('.mb-2')
    expect(iconContainer).not.toBeInTheDocument()
  })

  it('should handle zero value', () => {
    render(
      <MetricCard
        label="Value"
        value={0}
        unit="unit"
        color="#000000"
      />
    )

    expect(screen.getByText('0.0')).toBeInTheDocument()
  })

  it('should handle negative values', () => {
    render(
      <MetricCard
        label="Temperature"
        value={-10.5}
        unit="°C"
        color="#ef4444"
      />
    )

    expect(screen.getByText('-10.5')).toBeInTheDocument()
  })

  it('should handle large values', () => {
    render(
      <MetricCard
        label="CO2"
        value={9999.9}
        unit="ppm"
        color="#10b981"
      />
    )

    expect(screen.getByText('9999.9')).toBeInTheDocument()
  })

  it('should render multiple MetricCards independently', () => {
    const { rerender } = render(
      <MetricCard
        label="Temp 1"
        value={20}
        unit="°C"
        color="#ef4444"
      />
    )

    expect(screen.getByText('Temp 1')).toBeInTheDocument()
    expect(screen.getByText('20.0')).toBeInTheDocument()

    rerender(
      <MetricCard
        label="Temp 2"
        value={30}
        unit="°C"
        color="#3b82f6"
      />
    )

    expect(screen.getByText('Temp 2')).toBeInTheDocument()
    expect(screen.getByText('30.0')).toBeInTheDocument()
  })

  it('should use Card component for styling', () => {
    const { container } = render(
      <MetricCard
        label="Test"
        value={42}
        unit="unit"
        color="#000000"
      />
    )

    // Card component should add these classes
    const card = container.querySelector('.bg-white.rounded-lg.shadow-md')
    expect(card).toBeInTheDocument()
  })

  it('should render with SVG icon', () => {
    const svgIcon = (
      <svg data-testid="svg-icon" viewBox="0 0 24 24">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
      </svg>
    )

    render(
      <MetricCard
        label="Test"
        value={42}
        unit="unit"
        color="#000000"
        icon={svgIcon}
      />
    )

    expect(screen.getByTestId('svg-icon')).toBeInTheDocument()
  })

  it('should handle different color formats', () => {
    const { rerender } = render(
      <MetricCard
        label="Test"
        value={42}
        unit="unit"
        color="rgb(255, 0, 0)"
      />
    )

    let valueElement = screen.getByText('42.0')
    expect(valueElement).toHaveStyle({ color: 'rgb(255, 0, 0)' })

    rerender(
      <MetricCard
        label="Test"
        value={42}
        unit="unit"
        color="rgba(0, 255, 0, 0.5)"
      />
    )

    valueElement = screen.getByText('42.0')
    expect(valueElement).toHaveStyle({ color: 'rgba(0, 255, 0, 0.5)' })
  })
})
