import { createBrowserRouter } from "react-router-dom";
import LoginPage from "../pages/LoginPage";
import POSPage from "../pages/POSPage";
import PurchasePage from "../pages/PurchasePage";
import DashboardPage from "../pages/DashboardPage";
import ClosingShiftPage from "../pages/ClosingShiftPage";
import SettingsPage from "../components/SettingsPage";
import PaymentPage from "../pages/PaymentPage";
import CustomersPage from "../components/CustomersPage";
import CartPage from "../components/CartPage";
import MobileCustomersPage from "../components/MobileCustomersPage";
import MobileAddCustomerPage from "../components/MobileAddCustomerPage";
import MobilePaymentPage from "../components/MobilePaymentPage";
import ProtectedRoute from "../components/ProtectedRoute";
import AdminRoute from "../components/AdminRoute";
import App from "../App";
import HomePage from "../pages/HomePage";
import InvoiceHistoryPage from "../pages/InvoiceHistory";
import InvoiceViewPage from "../pages/InvoiceViewPage";
import PurchaseInvoiceHistoryPage from "../pages/PurchaseInvoiceHistory";
import PurchaseInvoiceViewPage from "../pages/PurchaseInvoiceViewPage";
import CustomerDetailsPage from "../pages/CustomerPageDetails";
import ItemsPage from "../pages/ItemsPage";
import ItemDetailPage from "../pages/ItemDetailPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <HomePage />, // This will redirect to /pos or /login
      },
      {
        path: "login",
        element: <LoginPage />,
      },
      {
        path: "pos",
        element: <ProtectedRoute element={<POSPage />} />,
      },
      {
        path: "purchase",
        element: <AdminRoute element={<PurchasePage />} />,
      },
      {
        path: "dashboard",
        element: <ProtectedRoute element={<DashboardPage />} />,
      },
      {
        path: "closing_shift",
        element: <ProtectedRoute element={<ClosingShiftPage />} />,
      },
      {
        path: "invoice",
        element: <ProtectedRoute element={<InvoiceHistoryPage />} />,
      },
      {
        path: "invoice/:id",
        element: <ProtectedRoute element={<InvoiceViewPage />} />,
      },
      {
        path: "purchase-invoice",
        element: <AdminRoute element={<PurchaseInvoiceHistoryPage />} />,
      },
      {
        path: "purchase-invoice/:id",
        element: <AdminRoute element={<PurchaseInvoiceViewPage />} />,
      },
      {
        path: "customers",
        element: <ProtectedRoute element={<CustomersPage />} />,
      },
      {
        path: "customers/:id",
        element: <ProtectedRoute element={<CustomerDetailsPage />} />,
      },
      {
        path: "items",
        element: <ProtectedRoute element={<ItemsPage />} />,
      },
      {
        path: "items/:itemCode",
        element: <ProtectedRoute element={<ItemDetailPage />} />,
      },
      {
        path: "cart",
        element: <ProtectedRoute element={<CartPage />} />,
      },
      {
        path: "mobile/customers",
        element: <ProtectedRoute element={<MobileCustomersPage />} />,
      },
      {
        path: "mobile/add-customer",
        element: <ProtectedRoute element={<MobileAddCustomerPage />} />,
      },
      {
        path: "mobile/payment",
        element: <ProtectedRoute element={<MobilePaymentPage />} />,
      },
      {
        path: "settings",
        element: <ProtectedRoute element={<SettingsPage />} />,
      },
      {
        path: "payment/:invoiceId",
        element: <ProtectedRoute element={<PaymentPage />} />,
      },
    ],
  },
], {
  basename: "/klik_pos"
});

export default router;
