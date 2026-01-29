import { Receipt, Grid3X3, BarChart3, Users, MonitorX, Package, ShoppingBag, PackagePlus } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom"
import { useUserInfo } from "../hooks/useUserInfo"

// Inside your component
export default function RetailSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userInfo } = useUserInfo()
  const isAdminUser = userInfo?.is_admin_user || false

  // Base menu items (always visible)
  const baseMenuItems = [
    { icon: Grid3X3, path: "/pos", label: "POS" },
    { icon: Receipt, path: "/invoice", label: "Invoice" },
    { icon: Package, path: "/items", label: "Items" },
    { icon: Users, path: "/customers", label: "Customers" },
    { icon: BarChart3, path: "/dashboard", label: "Dashboard" },
    { icon: MonitorX, path: "/closing_shift", label: "Closing Shift" },
  ]

  // Admin-only menu items (Purchase module)
  const adminMenuItems = [
    { icon: PackagePlus, path: "/purchase", label: "Purchase" },
    { icon: ShoppingBag, path: "/purchase-invoice", label: "Purchase Invoice" },
  ]

  // Combine menu items based on user role
  const menuItems = isAdminUser
    ? [
        baseMenuItems[0], // POS
        ...adminMenuItems, // Purchase, Purchase Invoice
        ...baseMenuItems.slice(1), // Rest of menu items
      ]
    : baseMenuItems

  const isActive = (path: string) => {
    if (path === "/pos") {
      return location.pathname === "/" || location.pathname === "/pos"
    }
    // Exact match for /purchase to avoid matching /purchase-invoice
    if (path === "/purchase") {
      return location.pathname === "/purchase"
    }
    return location.pathname.startsWith(path)
  }

  return (
<div className="hidden lg:flex fixed h-screen w-20 top-0 left-0 bg-white dark:bg-gray-800 shadow-lg flex-col border-r border-gray-200 dark:border-gray-700 z-50">
      {/* Logo Section - Fixed height to match other sections */}
      <div
          className="h-20 flex items-center justify-center border-gray-100 dark:border-gray-700 cursor-pointer active:scale-90 transition-transform duration-150"
          onClick={() => navigate("/")}
        >
          <img
            src="/assets/klik_pos/klik_spa/beveren-logo-180.png"
            alt="KLiK PoS"
            className="w-12 h-12 rounded-full object-cover"
          />
        </div>

      {/* Menu Items - Flexible space */}
      <div className="flex-1 flex flex-col items-center py-6 space-y-4">
        {menuItems.map((item, index) => (
          <button
            key={index}
            onClick={() => navigate(item.path)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-90 duration-150 ${
              isActive(item.path)
                ? "bg-beveren-100 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                : "text-beveren-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            title={item.label}
          >
            <item.icon size={20} />
          </button>
        ))}
      </div>

      {/* Settings at bottom */}
      {/* <div className="p-4 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={() => navigate("/settings")}
          className="w-12 h-12 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mx-auto"
        >
          <Settings size={20} />
        </button>
      </div> */}
    </div>
  )
}
