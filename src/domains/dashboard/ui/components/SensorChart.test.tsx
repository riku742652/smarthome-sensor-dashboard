import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SensorChart } from './SensorChart'
import type { ChartDataPoint } from '@domains/dashboard/types'

describe('SensorChart', () => {
  const mockData: ChartDataPoint[] = [
    {
      timestamp: 1700000000000,
      date: new Date(1700000000000),
      temperature: 25.5,
      humidity: 60.0,
      co2: 800,
    },
    {
      timestamp: 1700000060000,
      date: new Date(1700000060000),
      temperature: 25.6,
      humidity: 61.0,
      co2: 810,
    },
    {
      timestamp: 1700000120000,
      date: new Date(1700000120000),
      temperature: 25.7,
      humidity: 62.0,
      co2: 820,
    },
  ]

  beforeEach(() => {
    // Any setup needed before each test
  })

  it('should render chart components', () => {
    const { container } = render(<SensorChart data={mockData} />)

    // Verify main chart structure renders
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should render ResponsiveContainer', () => {
    render(<SensorChart data={mockData} />)

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
  })

  it('should render LineChart with data', () => {
    render(<SensorChart data={mockData} />)

    const lineChart = screen.getByTestId('line-chart')
    expect(lineChart).toBeInTheDocument()

    const chartData = lineChart.getAttribute('data-chart-data')
    expect(chartData).toBeTruthy()
  })

  it('should render all three metric lines', () => {
    render(<SensorChart data={mockData} />)

    expect(screen.getByTestId('line-temperature')).toBeInTheDocument()
    expect(screen.getByTestId('line-humidity')).toBeInTheDocument()
    expect(screen.getByTestId('line-co2')).toBeInTheDocument()
  })

  it('should render chart axes and grid', () => {
    render(<SensorChart data={mockData} />)

    expect(screen.getByTestId('x-axis')).toBeInTheDocument()
    expect(screen.getAllByTestId('y-axis')).toHaveLength(2)
    expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument()
  })

  it('should render Tooltip and Legend', () => {
    render(<SensorChart data={mockData} />)

    expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    expect(screen.getByTestId('legend')).toBeInTheDocument()
  })

  it('should handle empty data array', () => {
    render(<SensorChart data={[]} />)

    const lineChart = screen.getByTestId('line-chart')
    expect(lineChart).toBeInTheDocument()

    const chartData = lineChart.getAttribute('data-chart-data')
    expect(JSON.parse(chartData!)).toEqual([])
  })

  it('should handle single data point', () => {
    const singleData = [mockData[0]]

    render(<SensorChart data={singleData} />)

    const lineChart = screen.getByTestId('line-chart')
    const chartData = JSON.parse(lineChart.getAttribute('data-chart-data')!)

    expect(chartData).toHaveLength(1)
    expect(chartData[0].temperature).toBe(25.5)
  })

  it('should apply colors to metric lines', () => {
    render(<SensorChart data={mockData} />)

    const tempLine = screen.getByTestId('line-temperature')
    const humidityLine = screen.getByTestId('line-humidity')
    const co2Line = screen.getByTestId('line-co2')

    // Check that color attributes are set
    expect(tempLine.getAttribute('data-stroke')).toBeTruthy()
    expect(humidityLine.getAttribute('data-stroke')).toBeTruthy()
    expect(co2Line.getAttribute('data-stroke')).toBeTruthy()
  })

  it('should apply names to metric lines', () => {
    render(<SensorChart data={mockData} />)

    const tempLine = screen.getByTestId('line-temperature')
    const humidityLine = screen.getByTestId('line-humidity')
    const co2Line = screen.getByTestId('line-co2')

    // Check that names are set
    expect(tempLine.getAttribute('data-name')).toBeTruthy()
    expect(humidityLine.getAttribute('data-name')).toBeTruthy()
    expect(co2Line.getAttribute('data-name')).toBeTruthy()
  })

  it('should handle data updates', () => {
    const { rerender } = render(<SensorChart data={mockData} />)

    const newData: ChartDataPoint[] = [
      {
        timestamp: 1700000180000,
        date: new Date(1700000180000),
        temperature: 26.0,
        humidity: 65.0,
        co2: 850,
      },
    ]

    rerender(<SensorChart data={newData} />)

    const lineChart = screen.getByTestId('line-chart')
    const chartData = JSON.parse(lineChart.getAttribute('data-chart-data')!)

    expect(chartData).toHaveLength(1)
    expect(chartData[0].temperature).toBe(26.0)
  })

  it('should render chart with large dataset', () => {
    const largeData: ChartDataPoint[] = Array.from({ length: 100 }, (_, i) => ({
      timestamp: 1700000000000 + i * 60000,
      date: new Date(1700000000000 + i * 60000),
      temperature: 25 + i * 0.1,
      humidity: 60 + i * 0.1,
      co2: 800 + i,
    }))

    render(<SensorChart data={largeData} />)

    const lineChart = screen.getByTestId('line-chart')
    const chartData = JSON.parse(lineChart.getAttribute('data-chart-data')!)

    expect(chartData).toHaveLength(100)
  })
})
