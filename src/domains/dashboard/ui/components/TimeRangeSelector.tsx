import type { TimeRange } from '@domains/dashboard/types'
import { TIME_RANGE_LABELS } from '@domains/dashboard/types'

interface TimeRangeSelectorProps {
  selectedRange: TimeRange
  onChange: (range: TimeRange) => void
}

export function TimeRangeSelector({
  selectedRange,
  onChange,
}: TimeRangeSelectorProps) {
  const ranges: TimeRange[] = ['1h', '6h', '12h', '24h', '7d']

  return (
    <div className="flex gap-2">
      {ranges.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedRange === range
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {TIME_RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  )
}
