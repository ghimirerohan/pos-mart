"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Loader2, Search, ChevronDown } from "lucide-react";
import { useDeliveryPersonnel } from "../hooks/useDeliveryPersonnel";

interface DeliveryPersonnelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (personnelName: string) => void;
}

export default function DeliveryPersonnelModal({
  isOpen,
  onClose,
  onSelect,
}: DeliveryPersonnelModalProps) {
  const { personnel, loading, error } = useDeliveryPersonnel();
  const [selectedPersonnel, setSelectedPersonnel] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedPersonnel("");
      setSearchQuery("");
      setIsDropdownOpen(false);
    }
  }, [isOpen]);

  // Find selected personnel name for display
  const selectedPersonnelName = useMemo(() => {
    if (!selectedPersonnel) return "";
    const person = personnel.find((p) => p.name === selectedPersonnel);
    return person?.delivery_personnel || "";
  }, [selectedPersonnel, personnel]);

  // Filter personnel based on search query
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return personnel;
    const query = searchQuery.toLowerCase();
    return personnel.filter(
      (person) =>
        person.delivery_personnel.toLowerCase().includes(query) ||
        person.name.toLowerCase().includes(query)
    );
  }, [personnel, searchQuery]);

  if (!isOpen) return null;

  const handleSelect = (personnelName: string, personnelDisplayName: string) => {
    setSelectedPersonnel(personnelName);
    setSearchQuery(personnelDisplayName);
    setIsDropdownOpen(false);
  };

  const handleConfirm = () => {
    if (selectedPersonnel) {
      onSelect(selectedPersonnel);
      onClose();
    }
  };

  const handleInputChange = (value: string) => {
    setSearchQuery(value);
    setIsDropdownOpen(true);
    // Clear selection if user is typing and it doesn't match the selected name
    const currentSelectedName = personnel.find((p) => p.name === selectedPersonnel)?.delivery_personnel || "";
    if (value !== currentSelectedName) {
      setSelectedPersonnel("");
    }
  };

  const handleInputFocus = () => {
    setIsDropdownOpen(true);
  };

  const handleInputBlur = () => {
    // Delay closing to allow click on dropdown items
    setTimeout(() => {
      setIsDropdownOpen(false);
    }, 200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 delivery-personnel-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Select Delivery Personnel
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-beveren-600" />
              <span className="ml-2 text-gray-600 dark:text-gray-400">Loading...</span>
            </div>
          ) : error ? (
            <div className="text-red-600 dark:text-red-400 text-center py-8">
              {error}
            </div>
          ) : personnel.length === 0 ? (
            <div className="text-gray-600 dark:text-gray-400 text-center py-8">
              No delivery personnel available
            </div>
          ) : (
            <div className="relative">
              {/* Searchable Select Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
                <input
                  type="text"
                  placeholder="Search delivery personnel..."
                  value={searchQuery}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  className="w-full pl-10 pr-10 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  autoFocus
                />
                <ChevronDown
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 transition-transform ${
                    isDropdownOpen ? "rotate-180" : ""
                  }`}
                  size={18}
                />
              </div>

              {/* Dropdown List */}
              {isDropdownOpen && (
                <div className="absolute z-10 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {filteredPersonnel.length > 0 ? (
                      filteredPersonnel.map((person) => (
                        <button
                          key={person.name}
                          type="button"
                          onClick={() => handleSelect(person.name, person.delivery_personnel)}
                          className={`w-full text-left px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                            selectedPersonnel === person.name
                              ? "bg-beveren-50 dark:bg-beveren-900/20 text-beveren-600 dark:text-beveren-400"
                              : "text-gray-900 dark:text-white"
                          }`}
                        >
                          <div className="font-medium">{person.delivery_personnel}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-gray-500 dark:text-gray-400 text-center">
                        No matches found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedPersonnel || loading}
            className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
