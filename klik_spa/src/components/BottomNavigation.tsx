import { Receipt, FileText, Grid3X3, BarChart3, Users, Package, PackagePlus, ShoppingBag, ClipboardList } from "lucide-react"
import { useNavigate, useLocation } from "react-router-dom"
import { useUserInfo } from "../hooks/useUserInfo"

export default function BottomNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userInfo } = useUserInfo()
  // Only Administrator role can see Purchase module (not Sales Manager or System Manager)
  const isAdministrator = userInfo?.is_administrator || false
  const canAccessDateWiseInventory = userInfo?.can_access_date_wise_inventory || false
  // Show Date Wise Inventory to Administrator or users with Date Wise Inventory Manager role
  const showDateWiseInventory = isAdministrator || canAccessDateWiseInventory

  // Base menu items (always visible)
  const baseMenuItems = [
    { icon: Grid3X3, path: "/pos", label: "POS" },
    { icon: Receipt, path: "/invoice", label: "Invoice" },
    { icon: Package, path: "/items", label: "Items" },
    { icon: Users, path: "/customers", label: "Customers" },
    { icon: BarChart3, path: "/dashboard", label: "Dashboard" },
    { icon: FileText, path: "/closing_shift", label: "Closing" },
  ]

  // Administrator-only menu items (Purchase module)
  const adminMenuItems = [
    { icon: PackagePlus, path: "/purchase", label: "Purchase" },
    { icon: ShoppingBag, path: "/purchase-invoice", label: "Purch Inv" },
  ]

  // Date Wise Inventory (Administrator or role "Date Wise Inventory Manager")
  const dateWiseInventoryItem = showDateWiseInventory
    ? [{ icon: ClipboardList, path: "/date-wise-inventory", label: "Inventory" }]
    : []

  // Combine menu items based on user role
  const menuItems = isAdministrator
    ? [
        baseMenuItems[0], // POS
        ...adminMenuItems, // Purchase, Purchase Invoice
        ...dateWiseInventoryItem,
        ...baseMenuItems.slice(1), // Rest of menu items
      ]
    : [...baseMenuItems.slice(0, 1), ...dateWiseInventoryItem, ...baseMenuItems.slice(1)]

  const isActive = (path: string) => {
    if (path === "/pos") {
      return location.pathname === "/" || location.pathname === "/pos"
    }
    // Exact match for /purchase to avoid matching /purchase-invoice
    if (path === "/purchase") {
      return location.pathname === "/purchase"
    }
    if (path === "/date-wise-inventory") {
      return location.pathname === "/date-wise-inventory"
    }
    return location.pathname.startsWith(path)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-50 safe-area-pb">
      <div className="flex items-center justify-around py-2 px-4">
        {menuItems.map((item, index) => (
          <button
            key={index}
            onClick={() => navigate(item.path)}
            className={`flex flex-col items-center justify-center min-w-0 flex-1 py-2 px-1 transition-colors ${
              isActive(item.path)
                ? "text-beveren-600 dark:text-beveren-400"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            <item.icon
              size={20}
              className={`mb-1 ${
                isActive(item.path)
                  ? "text-beveren-600 dark:text-beveren-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            />
            <span
              className={`text-xs font-medium truncate ${
                isActive(item.path)
                  ? "text-beveren-600 dark:text-beveren-400"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
