import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import NewEngagement from './pages/NewEngagement'
import EngagementDetail from './pages/EngagementDetail'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/engagements/new" element={<NewEngagement />} />
          <Route path="/engagements/:id" element={<EngagementDetail />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
