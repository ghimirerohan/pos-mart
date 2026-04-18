import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import POSOpeningEntryGuard from './POSOpeningEntryGuard';

const ProtectedRoute = ({ element }: { element: React.ReactElement }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // Show loading spinner while checking authentication
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 to-brand-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-700 mb-4">R-POS</div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-700 mx-auto"></div>
          <p className="text-brand-600 mt-4">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Save the attempted location for redirecting after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Wrap the element with POSOpeningEntryGuard to ensure opening entry exists
  return (
    <POSOpeningEntryGuard excludePaths={['/settings', '/cashier_insights', '/session_insights']}>
      {element}
    </POSOpeningEntryGuard>
  );
};

export default ProtectedRoute;
