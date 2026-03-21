"use client"

import { useMediaQuery } from "../hooks/useMediaQuery"

export default function Footer() {
  // Hide footer on mobile/tablet screens (same breakpoint as mobile layout)
  const isMobile = useMediaQuery("(max-width: 1024px)")

  // Don't render footer on mobile devices
  if (isMobile) {
    return null
  }

  return (
    <footer className="fixed bottom-0 left-20 right-0 bg-brand-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-10">
      <div className="w-full py-2 flex justify-between items-center px-4">

        <div className="text-sm text-brand-600 dark:text-brand-400 font-bold">
          R-POS
        </div>

        <div className="text-xs text-gray-600 dark:text-gray-400">
          © {new Date().getFullYear()}
        </div>
      </div>
    </footer>

  )
}
