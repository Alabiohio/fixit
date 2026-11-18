import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';

// Public pages
import { LandingPage } from './pages/public/LandingPage';
import { HowItWorksPage } from './pages/public/HowItWorksPage';
import { ServicesPage } from './pages/public/ServicesPage';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from './pages/public/AuthPages';

// Customer pages
import { CustomerDashboardPage } from './pages/customer/CustomerDashboardPage';
import { PostJobPage } from './pages/customer/PostJobPage';
import { CustomerJobsPage } from './pages/customer/CustomerJobsPage';
import { CustomerJobDetailPage } from './pages/customer/CustomerJobDetailPage';
import { CustomerBookingsPage } from './pages/customer/CustomerBookingsPage';
import {
  CustomerNotificationsPage,
  CustomerSettingsPage,
} from './pages/customer/CustomerNotificationsSettings';

// Worker pages
import { WorkerDashboardPage } from './pages/worker/WorkerDashboardPage';
import { WorkerJobsBoardPage } from './pages/worker/WorkerJobsBoardPage';
import { WorkerJobDetailPage } from './pages/worker/WorkerJobDetailPage';
import { WorkerOffersPage } from './pages/worker/WorkerOffersPage';
import { WorkerBookingsPage } from './pages/worker/WorkerBookingsPage';
import {
  WorkerNotificationsPage,
  WorkerProfilePage,
} from './pages/worker/WorkerNotificationsProfile';

// Checkout pages
import { CheckoutCancelPage, CheckoutSuccessPage } from './pages/checkout/CheckoutPages';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Customer Routes */}
          <Route
            path="/customer/dashboard"
            element={
              <ProtectedRoute>
                <CustomerDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/jobs"
            element={
              <ProtectedRoute>
                <CustomerJobsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/jobs/new"
            element={
              <ProtectedRoute>
                <PostJobPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/jobs/:id"
            element={
              <ProtectedRoute>
                <CustomerJobDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/bookings"
            element={
              <ProtectedRoute>
                <CustomerBookingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/notifications"
            element={
              <ProtectedRoute>
                <CustomerNotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/settings"
            element={
              <ProtectedRoute>
                <CustomerSettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Worker Routes */}
          <Route
            path="/worker/dashboard"
            element={
              <ProtectedRoute>
                <WorkerDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/jobs"
            element={
              <ProtectedRoute>
                <WorkerJobsBoardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/jobs/:id"
            element={
              <ProtectedRoute>
                <WorkerJobDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/offers"
            element={
              <ProtectedRoute>
                <WorkerOffersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/bookings"
            element={
              <ProtectedRoute>
                <WorkerBookingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/notifications"
            element={
              <ProtectedRoute>
                <WorkerNotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/worker/profile"
            element={
              <ProtectedRoute>
                <WorkerProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Stripe Checkout Return Routes */}
          <Route
            path="/checkout/success"
            element={
              <ProtectedRoute>
                <CheckoutSuccessPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/checkout/cancel"
            element={
              <ProtectedRoute>
                <CheckoutCancelPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
