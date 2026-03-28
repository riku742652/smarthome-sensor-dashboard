import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
} as any

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any

// Mock Recharts
vi.mock('recharts', () => {
  const React = require('react')

  return {
    ResponsiveContainer: ({ children }: any) =>
      React.createElement('div', { 'data-testid': 'responsive-container' }, children),
    LineChart: ({ children, data }: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'line-chart', 'data-chart-data': JSON.stringify(data) },
        children
      ),
    Line: ({ dataKey, stroke, name }: any) =>
      React.createElement('div', {
        'data-testid': `line-${dataKey}`,
        'data-stroke': stroke,
        'data-name': name,
      }),
    XAxis: (props: any) =>
      React.createElement('div', {
        'data-testid': 'x-axis',
        'data-props': JSON.stringify(props),
      }),
    YAxis: (props: any) =>
      React.createElement('div', {
        'data-testid': 'y-axis',
        'data-props': JSON.stringify(props),
      }),
    CartesianGrid: (props: any) =>
      React.createElement('div', {
        'data-testid': 'cartesian-grid',
        'data-props': JSON.stringify(props),
      }),
    Tooltip: ({ content }: any) =>
      React.createElement('div', { 'data-testid': 'tooltip' }, content),
    Legend: () => React.createElement('div', { 'data-testid': 'legend' }),
  }
})
