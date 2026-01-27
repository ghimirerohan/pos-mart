import React, { useState, useEffect } from "react";
import {
  X,
  Building,
  Mail,
  MapPin,
  Save,
  Truck,
} from "lucide-react";
import type { Supplier, SupplierGroup, CreateSupplierData } from "../types/supplier";
import { toast } from "react-toastify";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import countryList from "react-select-country-list";

type CountryOption = { value: string; label: string };

interface AddSupplierModalProps {
  supplier?: Supplier | null;
  onClose: () => void;
  onSave: (supplier: Partial<Supplier>) => void;
  isFullPage?: boolean;
  prefilledName?: string;
}

export default function AddSupplierModal({
  supplier,
  onClose,
  onSave,
  isFullPage = false,
  prefilledName = "",
}: AddSupplierModalProps) {
  const isEditing = !!supplier;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const countryOptions: CountryOption[] = countryList().getData();

  const [formData, setFormData] = useState({
    supplier_name: "",
    contact_name: "",
    email: "",
    phone: "",
    supplier_group: "All Supplier Groups",
    supplier_type: "Company" as "Company" | "Individual",
    country: "Nepal",
    address: {
      addressType: "Billing",
      street: "",
      city: "",
      state: "",
      zipCode: "",
      country: "Nepal",
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Fetch supplier groups
  useEffect(() => {
    const fetchSupplierGroups = async () => {
      try {
        const response = await fetch('/api/method/klik_pos.api.supplier.get_supplier_groups', {
          method: 'GET',
          credentials: 'include',
        });
        const data = await response.json();
        if (data.message?.success) {
          setSupplierGroups(data.message.data || []);
        }
      } catch (error) {
        console.error('Error fetching supplier groups:', error);
      } finally {
        setLoadingGroups(false);
      }
    };

    fetchSupplierGroups();
  }, []);

  // Initialize form data
  useEffect(() => {
    if (supplier) {
      setFormData({
        supplier_name: supplier.supplier_name || "",
        contact_name: supplier.contact?.first_name || "",
        email: supplier.contact?.email_id || "",
        phone: supplier.contact?.phone || supplier.contact?.mobile_no || "",
        supplier_group: supplier.supplier_group || "All Supplier Groups",
        supplier_type: supplier.supplier_type || "Company",
        country: supplier.country || "Nepal",
        address: {
          addressType: "Billing",
          street: supplier.address?.address_line1 || "",
          city: supplier.address?.city || "",
          state: supplier.address?.state || "",
          zipCode: supplier.address?.pincode || "",
          country: supplier.address?.country || supplier.country || "Nepal",
        },
      });
    } else if (prefilledName) {
      setFormData((prev) => ({
        ...prev,
        supplier_name: prefilledName,
      }));
    }
  }, [supplier, prefilledName]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.supplier_name.trim()) {
      newErrors.supplier_name = "Supplier name is required";
    }

    // Email format validation if provided
    if (
      formData.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      newErrors.email = "Please enter a valid email address";
    }

    // Phone validation if provided
    if (formData.phone.trim()) {
      const digitsOnly = formData.phone.replace(/\D/g, '');
      if (digitsOnly.length < 10) {
        newErrors.phone = "Phone number must have at least 10 digits";
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      const firstErrorKey = Object.keys(newErrors)[0];
      if (firstErrorKey) {
        toast.error(newErrors[firstErrorKey]);
      }
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) return;
    setIsSubmitting(true);

    try {
      const supplierData: CreateSupplierData = {
        supplier_name: formData.supplier_name,
        contact_name: formData.contact_name || formData.supplier_name,
        email: formData.email,
        phone: formData.phone,
        supplier_group: formData.supplier_group,
        supplier_type: formData.supplier_type,
        country: formData.country,
        address: formData.address,
      };

      const endpoint = isEditing && supplier?.id
        ? '/api/method/klik_pos.api.supplier.update_supplier'
        : '/api/method/klik_pos.api.supplier.create_supplier';

      const body = isEditing && supplier?.id
        ? JSON.stringify({ supplier_id: supplier.id, supplier_data: supplierData })
        : JSON.stringify({ supplier_data: supplierData });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'include',
      });

      const data = await response.json();

      if (data.message?.success) {
        toast.success(isEditing ? 'Supplier updated successfully' : 'Supplier created successfully');
        
        // Create supplier object to return
        const savedSupplier: Partial<Supplier> = {
          id: data.message.supplier_name || supplier?.id,
          name: data.message.supplier_name || supplier?.id,
          supplier_name: formData.supplier_name,
          supplier_type: formData.supplier_type,
          supplier_group: formData.supplier_group,
          country: formData.country,
          contact: {
            first_name: formData.contact_name,
            email_id: formData.email,
            phone: formData.phone,
          },
          total_orders: 0,
          total_spent: 0,
        };

        onSave(savedSupplier);
        onClose();
      } else {
        throw new Error(data.message?.error || 'Failed to save supplier');
      }
    } catch (error) {
      console.error("Supplier save error:", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to save supplier. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSaveSupplier = (): boolean => {
    return formData.supplier_name.trim() !== "";
  };

  return (
    <div
      className={
        isFullPage
          ? "h-full"
          : "fixed inset-0 bg-black/70 bg-opacity-50 flex items-center justify-center p-4 z-50"
      }
    >
      <div
        className={
          isFullPage
            ? "h-full bg-white dark:bg-gray-800 flex flex-col"
            : "bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        }
      >
        {/* Header */}
        {!isFullPage && (
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-center">
              <Truck size={24} className="text-amber-600 mr-3" />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {isEditing ? "Edit Supplier" : "Add New Supplier"}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className={
            isFullPage
              ? "flex-1 flex flex-col"
              : "flex flex-col h-full"
          }
        >
          <div className={
            isFullPage
              ? "flex-1 p-6 space-y-6 overflow-y-auto"
              : "flex-1 p-6 space-y-6 overflow-y-auto"
          }>
            {/* Basic Information */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <Building size={20} className="mr-2 text-amber-600" />
                Basic Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="supplier_name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Supplier Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="supplier_name"
                    value={formData.supplier_name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, supplier_name: e.target.value }))
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
                      errors.supplier_name ? "border-red-500" : "border-gray-300"
                    }`}
                    placeholder="Enter supplier name"
                  />
                  {errors.supplier_name && (
                    <p className="text-red-500 text-xs mt-1">{errors.supplier_name}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="contact_name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Contact Person
                  </label>
                  <input
                    type="text"
                    id="contact_name"
                    value={formData.contact_name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, contact_name: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Enter contact person name"
                  />
                </div>

                <div>
                  <label
                    htmlFor="supplier_group"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Supplier Group
                  </label>
                  <select
                    id="supplier_group"
                    value={formData.supplier_group}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, supplier_group: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                    disabled={loadingGroups}
                  >
                    {loadingGroups ? (
                      <option>Loading...</option>
                    ) : (
                      supplierGroups.map((group) => (
                        <option key={group.name} value={group.name}>
                          {group.supplier_group_name || group.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="supplier_type"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Supplier Type
                  </label>
                  <select
                    id="supplier_type"
                    value={formData.supplier_type}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        supplier_type: e.target.value as "Company" | "Individual",
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="Company">Company</option>
                    <option value="Individual">Individual</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <Mail size={20} className="mr-2 text-amber-600" />
                Contact Information
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, email: e.target.value }))
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
                      errors.email ? "border-red-500" : "border-gray-300"
                    }`}
                    placeholder="supplier@email.com"
                  />
                  {errors.email && (
                    <p className="text-red-500 text-xs mt-1">{errors.email}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Phone Number
                  </label>
                  <PhoneInput
                    id="phone"
                    international
                    defaultCountry="NP"
                    value={formData.phone}
                    onChange={(value: string | undefined) =>
                      setFormData((prev) => ({ ...prev, phone: value || "" }))
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white ${
                      errors.phone ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                    }`}
                  />
                  {errors.phone && (
                    <p className="text-red-500 text-xs mt-1">{errors.phone}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Address Section */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <MapPin size={20} className="mr-2 text-amber-600" />
                Address (Optional)
              </h3>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="street"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Street Address
                    </label>
                    <input
                      type="text"
                      id="street"
                      value={formData.address.street}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          address: { ...prev.address, street: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Enter street address"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="city"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      City
                    </label>
                    <input
                      type="text"
                      id="city"
                      value={formData.address.city}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          address: { ...prev.address, city: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Enter city"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label
                      htmlFor="state"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      State/Province
                    </label>
                    <input
                      type="text"
                      id="state"
                      value={formData.address.state}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          address: { ...prev.address, state: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Enter state"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="zipCode"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Zip Code
                    </label>
                    <input
                      type="text"
                      id="zipCode"
                      value={formData.address.zipCode}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          address: { ...prev.address, zipCode: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Enter zip code"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="country"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                    >
                      Country
                    </label>
                    <input
                      list="country-list"
                      id="country"
                      value={formData.address.country}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          country: e.target.value,
                          address: { ...prev.address, country: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Select country"
                    />
                    <datalist id="country-list">
                      {countryOptions.map((country) => (
                        <option key={country.value} value={country.label} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>
            </div>

            {/* Error Display */}
            {submitError && (
              <div className="p-3 bg-red-100 text-red-700 rounded-lg">
                {submitError}
              </div>
            )}
          </div>

          {/* Fixed Footer with Save Button */}
          <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-6">
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !canSaveSupplier()}
                className={`px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center space-x-2 ${
                  isSubmitting || !canSaveSupplier() ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin">↻</span>
                    <span>{isEditing ? "Updating..." : "Creating..."}</span>
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    <span>
                      {isEditing ? "Update Supplier" : "Save Supplier"}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
