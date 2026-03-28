import { vi } from 'vitest'
import { ReactNode } from 'react'

/**
 * Recharts mock for testing
 * Recharts relies on browser APIs that don't exist in jsdom,
 * so we mock the components to render simple divs for testing
 */

interface MockChartProps {
  children?: ReactNode
  data?: unknown[]
  width?: number | string
  height?: number | string
}

interface MockLineProps {
  dataKey?: string
  stroke?: string
  name?: string
  yAxisId?: string
  [key: string]: unknown
}

// ResponsiveContainer
export const ResponsiveContainer = ({ children }: MockChartProps) => (
  <div data-testid="responsive-container">{children}</div>
)

// LineChart
export const LineChart = ({ children, data }: MockChartProps) => (
  <div data-testid="line-chart" data-chart-data={JSON.stringify(data)}>
    {children}
  </div>
)

// Line
export const Line = ({ dataKey, stroke, name }: MockLineProps) => (
  <div
    data-testid={`line-${dataKey}`}
    data-stroke={stroke}
    data-name={name}
  />
)

// XAxis
export const XAxis = (props: Record<string, unknown>) => (
  <div data-testid="x-axis" data-props={JSON.stringify(props)} />
)

// YAxis
export const YAxis = (props: Record<string, unknown>) => (
  <div data-testid="y-axis" data-props={JSON.stringify(props)} />
)

// CartesianGrid
export const CartesianGrid = (props: Record<string, unknown>) => (
  <div data-testid="cartesian-grid" data-props={JSON.stringify(props)} />
)

// Tooltip
export const Tooltip = ({ content }: { content?: ReactNode }) => (
  <div data-testid="tooltip">{content}</div>
)

// Legend
export const Legend = () => <div data-testid="legend" />

// BarChart
export const BarChart = ({ children, data }: MockChartProps) => (
  <div data-testid="bar-chart" data-chart-data={JSON.stringify(data)}>
    {children}
  </div>
)

// Bar
export const Bar = ({ dataKey, fill }: { dataKey?: string; fill?: string }) => (
  <div data-testid={`bar-${dataKey}`} data-fill={fill} />
)

// PieChart
export const PieChart = ({ children }: MockChartProps) => (
  <div data-testid="pie-chart">{children}</div>
)

// Pie
export const Pie = ({ dataKey }: { dataKey?: string }) => (
  <div data-testid={`pie-${dataKey}`} />
)

// AreaChart
export const AreaChart = ({ children, data }: MockChartProps) => (
  <div data-testid="area-chart" data-chart-data={JSON.stringify(data)}>
    {children}
  </div>
)

// Area
export const Area = ({ dataKey, fill }: { dataKey?: string; fill?: string }) => (
  <div data-testid={`area-${dataKey}`} data-fill={fill} />
)

// Cell
export const Cell = ({ fill }: { fill?: string }) => (
  <div data-testid="cell" data-fill={fill} />
)

// Mock the entire recharts module
vi.mock('recharts', () => ({
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
  Cell,
}))
