import { useState, useEffect } from "react"
import { Receipt, FileText, Grid3X3, BarChart3, Users, Package, PackagePlus, ShoppingBag, ClipboardList, Menu, X, Activity } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom"
import { useUserInfo } from "../hooks/useUserInfo"

export default function BottomNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userInfo } = useUserInfo()
  const isAdministrator = userInfo?.is_administrator || false
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    setIsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  const userMenuItems = [
    { icon: Grid3X3, path: "/pos", label: "POS" },
    { icon: Receipt, path: "/invoice", label: "Invoice" },
    { icon: BarChart3, path: "/dashboard", label: "Dashboard" },
    { icon: FileText, path: "/closing_shift", label: "Closing" },
  ]

  const menuItems = isAdministrator
    ? [
        { icon: Grid3X3, path: "/pos", label: "POS" },
        { icon: PackagePlus, path: "/purchase", label: "Purchase" },
        { icon: ShoppingBag, path: "/purchase-invoice", label: "Purch Inv" },
        { icon: ClipboardList, path: "/date-wise-inventory", label: "Inventory" },
        { icon: Receipt, path: "/invoice", label: "Invoice" },
        { icon: Package, path: "/items", label: "Items" },
        { icon: Users, path: "/customers", label: "Customers" },
        { icon: BarChart3, path: "/dashboard", label: "Dashboard" },
        { icon: Activity, path: "/cashier_insights", label: "Insights" },
        { icon: FileText, path: "/closing_shift", label: "Closing" },
      ]
    : userMenuItems

  const isActive = (path: string) => {
    if (path === "/pos") {
      return location.pathname === "/" || location.pathname === "/pos"
    }
    if (path === "/purchase") {
      return location.pathname === "/purchase"
    }
    if (path === "/date-wise-inventory") {
      return location.pathname === "/date-wise-inventory"
    }
    if (path === "/cashier_insights") {
      return location.pathname === "/cashier_insights"
    }
    return location.pathname.startsWith(path)
  }

  return (
    <>
      {/* Hamburger Toggle Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-[14px] left-3 z-50 p-2 rounded-lg bg-white dark:bg-gray-800 shadow-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu size={20} className="text-gray-700 dark:text-gray-200" />
      </button>

      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/40 z-[60] transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsOpen(false)}
      />

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-full w-64 bg-white dark:bg-gray-800 z-[70] shadow-xl transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <img
              src="/assets/klik_pos/klik_spa/logo.jpeg"
              alt="R-POS"
              className="w-8 h-8 rounded-full object-cover"
            />
            <span className="font-bold text-lg text-brand-600 dark:text-brand-400">R-POS</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close navigation menu"
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="py-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 65px)" }}>
          {menuItems.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                navigate(item.path)
                setIsOpen(false)
              }}
              className={`flex items-center w-full px-4 py-3 text-sm font-medium transition-colors ${
                isActive(item.path)
                  ? "bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 border-r-3 border-brand-600 dark:border-brand-400"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
            >
              <item.icon
                size={20}
                className={`mr-3 flex-shrink-0 ${
                  isActive(item.path)
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  )
}
