/**
 * Purchase Page - Entry point for the Purchase module
 * Similar to POSPage but for purchase operations
 */

interface CurrentUser {
  name?: string;
  email?: string;
  full_name: string;
  role: string;
  user_image?: string;
}

import { useState, useEffect } from 'react'
import { useI18n } from "../hooks/useI18n"
import { usePOSOpeningStatus } from '../hooks/usePOSOpeningEntry'
import PurchasePOSLayout from "../components/PurchasePOSLayout"
import POSOpeningModal from '../components/PosOpeningEntryDialog'
import erpnextAPI from '../services/erpnext-api'
import { PackagePlus } from 'lucide-react'

export default function PurchasePage() {
  const { isRTL } = useI18n()
  const [showOpeningModal, setShowOpeningModal] = useState(false)
  const [posReady, setPosReady] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [userError, setUserError] = useState<string | null>(null)

  // Check POS opening status (Purchase also requires an open POS session)
  const {
    hasOpenEntry,
    isLoading: statusLoading,
    error: statusError,
    refetch
  } = usePOSOpeningStatus()

  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        setUserLoading(true)
        setUserError(null)

        erpnextAPI.initializeSession()

        const userProfile = await erpnextAPI.getCurrentUserProfile()

        if (userProfile) {
          setCurrentUser({
            name: userProfile.name,
            email: userProfile.email || userProfile.name,
            full_name: userProfile.full_name || userProfile.first_name + ' ' + (userProfile.last_name || ''),
            role: userProfile.role_profile_name || 'User',
            user_image: userProfile.user_image
          })
        } else {
          const basicUser = await erpnextAPI.getCurrentUser()
          if (basicUser) {
            setCurrentUser({
              name: basicUser as string,
              email: basicUser as string,
              full_name: basicUser as string,
              role: 'User'
            })
          } else {
            setUserError('No user session found')
          }
        }
      } catch (error) {
        console.error('Error fetching current user:', error)
        setUserError((error as Error).message || 'Failed to fetch user')
      } finally {
        setUserLoading(false)
      }
    }

    fetchCurrentUser()
  }, [])

  // Check opening entry status
  useEffect(() => {
    if (!statusLoading && !statusError) {
      if (hasOpenEntry === true) {
        setPosReady(true)
        setShowOpeningModal(false)
      } else if (hasOpenEntry === false) {
        setPosReady(false)
        setShowOpeningModal(false)
      }
    } else if (statusError) {
      console.error('Error checking POS opening status:', statusError)
      setPosReady(false)
      setShowOpeningModal(false)
    }
  }, [hasOpenEntry, statusLoading, statusError])

  // Handle successful opening entry creation
  const handleOpeningSuccess = () => {
    setShowOpeningModal(false)
    setPosReady(true)
    refetch()
  }

  const handleOpeningClose = () => {
    setShowOpeningModal(false)
  }

  // Show loading screen while checking status
  if (statusLoading || userLoading) {
    return (
      <div className={`min-h-screen bg-amber-50 dark:bg-gray-900 ${isRTL ? "rtl" : "ltr"} flex items-center justify-center`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Initializing Purchase Module</h2>
          <p className="text-gray-600 dark:text-gray-400">Checking your POS session status...</p>
        </div>
      </div>
    )
  }

  if (userError) {
    return (
      <div className={`min-h-screen bg-amber-50 dark:bg-gray-900 ${isRTL ? "rtl" : "ltr"} flex items-center justify-center`}>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
          <p className="text-gray-600 dark:text-gray-400">{userError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 ${isRTL ? "rtl" : "ltr"} pb-12`}>
      {/* Show Purchase Layout only when ready */}
      {posReady && <PurchasePOSLayout />}

      {/* Show a placeholder when not ready */}
      {!posReady && !showOpeningModal && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <PackagePlus size={40} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Purchase Module
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              A POS session is required to access the Purchase module. 
              This allows tracking of all purchase transactions within your shift.
            </p>
            <button
              onClick={() => setShowOpeningModal(true)}
              className="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium flex items-center gap-2 mx-auto"
            >
              <PackagePlus size={20} />
              Start POS Session
            </button>
          </div>
        </div>
      )}

      {/* POS Opening Modal */}
      <POSOpeningModal
        isOpen={showOpeningModal}
        onClose={handleOpeningClose}
        onSuccess={handleOpeningSuccess}
        currentUser={currentUser?.name || 'Unknown User'}
      />
    </div>
  )
}
