import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { ChartDataPoint } from '@domains/dashboard/types'
import { METRICS_CONFIG, CHART_CONFIG } from '@domains/dashboard/config'
import { formatTime } from '@shared/utils'

interface SensorChartProps {
  data: ChartDataPoint[]
}

export function SensorChart({ data }: SensorChartProps): JSX.Element {
  // カスタムツールチップ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload }: any): JSX.Element | null => {
    if (!active || !payload || payload.length === 0) {
      return null
    }

    const data = payload[0].payload

    return (
      <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3">
        <p className="text-sm font-semibold text-gray-900 mb-2">
          {formatTime(data.timestamp)}
        </p>
        <div className="space-y-1">
          <p className="text-sm" style={{ color: METRICS_CONFIG.temperature.color }}>
            {METRICS_CONFIG.temperature.label}: {data.temperature.toFixed(1)}{METRICS_CONFIG.temperature.unit}
          </p>
          <p className="text-sm" style={{ color: METRICS_CONFIG.humidity.color }}>
            {METRICS_CONFIG.humidity.label}: {data.humidity.toFixed(1)}{METRICS_CONFIG.humidity.unit}
          </p>
          <p className="text-sm" style={{ color: METRICS_CONFIG.co2.color }}>
            {METRICS_CONFIG.co2.label}: {Math.round(data.co2)}{METRICS_CONFIG.co2.unit}
          </p>
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_CONFIG.height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          stroke="#6b7280"
        />
        <YAxis yAxisId="left" stroke="#6b7280" />
        <YAxis yAxisId="right" orientation="right" stroke="#6b7280" />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="temperature"
          stroke={METRICS_CONFIG.temperature.color}
          name={METRICS_CONFIG.temperature.label}
          dot={false}
          strokeWidth={2}
          isAnimationActive={CHART_CONFIG.animationEnabled}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="humidity"
          stroke={METRICS_CONFIG.humidity.color}
          name={METRICS_CONFIG.humidity.label}
          dot={false}
          strokeWidth={2}
          isAnimationActive={CHART_CONFIG.animationEnabled}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="co2"
          stroke={METRICS_CONFIG.co2.color}
          name={METRICS_CONFIG.co2.label}
          dot={false}
          strokeWidth={2}
          isAnimationActive={CHART_CONFIG.animationEnabled}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
