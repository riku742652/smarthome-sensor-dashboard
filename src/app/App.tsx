import { SensorDashboard } from '@domains/sensor/ui/pages'
import { DashboardPage } from '@domains/dashboard/ui/pages'

export function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Smarthome Sensor Dashboard
          </h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <SensorDashboard />
        <DashboardPage />
      </main>

      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center text-sm text-gray-600">
          <p>Smarthome Sensor Dashboard © 2026</p>
        </div>
      </footer>
    </div>
  )
}
