import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useUserInfo } from '../hooks/useUserInfo';
import POSOpeningEntryGuard from './POSOpeningEntryGuard';

interface AdminRouteProps {
  element: React.ReactElement;
  excludeFromPOSGuard?: boolean;
}

/**
 * AdminRoute - Protects routes that should only be accessible by Administrator users
 * Redirects non-admin users to the POS page
 */
const AdminRoute = ({ element, excludeFromPOSGuard = false }: AdminRouteProps) => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { userInfo, isLoading: userInfoLoading } = useUserInfo();
  const location = useLocation();

  const isLoading = authLoading || userInfoLoading;

  if (isLoading) {
    // Show loading spinner while checking authentication and user info
    return (
      <div className="min-h-screen bg-gradient-to-br from-beveren-50 to-beveren-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-beveren-700 mb-4">KLiK PoS</div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-beveren-700 mx-auto"></div>
          <p className="text-beveren-600 mt-4">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Save the attempted location for redirecting after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if user is an admin
  const isAdminUser = userInfo?.is_admin_user || false;

  if (!isAdminUser) {
    // Non-admin users are redirected to POS page
    return <Navigate to="/pos" replace />;
  }

  // Wrap the element with POSOpeningEntryGuard if not excluded
  if (excludeFromPOSGuard) {
    return element;
  }

  return (
    <POSOpeningEntryGuard excludePaths={['/settings']}>
      {element}
    </POSOpeningEntryGuard>
  );
};

export default AdminRoute;
