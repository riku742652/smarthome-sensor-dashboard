import { Card } from '@shared/components'
import { ReactNode } from 'react'

interface MetricCardProps {
  label: string
  value: number
  unit: string
  color: string
  icon?: ReactNode
}

export function MetricCard({
  label,
  value,
  unit,
  color,
  icon,
}: MetricCardProps) {
  return (
    <Card className="flex flex-col items-center justify-center">
      {icon && <div className="mb-2">{icon}</div>}
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-3xl font-bold" style={{ color }}>
        {value.toFixed(1)}
        <span className="text-lg ml-1">{unit}</span>
      </p>
    </Card>
  )
}
