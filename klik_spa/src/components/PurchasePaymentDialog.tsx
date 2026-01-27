"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  X,
  CreditCard,
  Camera,
  Upload,
  Truck,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import type { PurchaseCartItem, Supplier, CreatePurchaseInvoiceData } from "../types/supplier";
import { toast } from "react-toastify";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { useProducts } from "../hooks/useProducts";

interface PurchasePaymentDialogProps {
  isOpen: boolean;
  onClose: (completed?: boolean) => void;
  cartItems: PurchaseCartItem[];
  selectedSupplier: Supplier;
  onCompletePayment: () => void;
  isMobile?: boolean;
}

interface PaymentMethod {
  mode_of_payment: string;
  amount: number;
}

export default function PurchasePaymentDialog({
  isOpen,
  onClose,
  cartItems,
  selectedSupplier,
  onCompletePayment,
  isMobile = false,
}: PurchasePaymentDialogProps) {
  const { posDetails } = usePOSDetails();
  const { refreshStockOnly, refetch: refetchProducts } = useProducts();
  const currency_symbol = posDetails?.currency_symbol || "₨";

  // Calculate totals first (needed for initial state)
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.purchase_price * item.quantity,
    0
  );
  const [taxAmount, setTaxAmount] = useState(0);
  const grandTotal = subtotal + taxAmount;

  // Payment state - initialize with the grand total
  const [isCreditPurchase, setIsCreditPurchase] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([
    { mode_of_payment: "Cash", amount: grandTotal },
  ]);
  const [availablePaymentModes] = useState([
    { name: "Cash" },
    { name: "Bank Transfer" },
    { name: "Cheque" },
  ]);

  // Reset and initialize payment amount when dialog opens
  useEffect(() => {
    if (isOpen && grandTotal > 0) {
      setPaymentMethods([{ mode_of_payment: "Cash", amount: grandTotal }]);
      setIsCreditPurchase(false);
      setIsComplete(false);
      setCreatedInvoice(null);
      setAttachmentFile(null);
      setAttachmentPreview(null);
      setUploadedFileUrl(null);
    }
  }, [isOpen]);

  // Update payment amount when grand total changes
  useEffect(() => {
    if (isOpen && !isCreditPurchase && paymentMethods.length === 1 && grandTotal > 0) {
      setPaymentMethods((prev) => {
        // Only update if amount is different to avoid infinite loop
        if (prev[0].amount !== grandTotal) {
          return [{ mode_of_payment: prev[0].mode_of_payment, amount: grandTotal }];
        }
        return prev;
      });
    }
  }, [grandTotal, isCreditPurchase, paymentMethods.length, isOpen]);

  // Attachment state
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<string | null>(null);

  // Tax state
  const [selectedTaxTemplate, setSelectedTaxTemplate] = useState<string>("");

  // Update payment amount
  const updatePaymentAmount = (index: number, amount: number) => {
    setPaymentMethods((prev) => {
      const updated = [...prev];
      updated[index].amount = amount;
      return updated;
    });
  };

  // Add payment method
  const addPaymentMethod = () => {
    setPaymentMethods((prev) => [...prev, { mode_of_payment: "Cash", amount: 0 }]);
  };

  // Remove payment method
  const removePaymentMethod = (index: number) => {
    if (paymentMethods.length > 1) {
      setPaymentMethods((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // Optimize image before upload
  const optimizeImage = useCallback(async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }

        // Max dimensions
        const maxWidth = 1920;
        const maxHeight = 1920;

        let { width, height } = img;

        // Scale down if necessary
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG at 80% quality
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not create blob"));
            }
          },
          "image/jpeg",
          0.8
        );
      };

      img.onerror = () => reject(new Error("Could not load image"));
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachmentPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Optimize if image
      if (file.type.startsWith("image/")) {
        const optimized = await optimizeImage(file);
        const optimizedFile = new File([optimized], file.name.replace(/\.[^/.]+$/, ".jpg"), {
          type: "image/jpeg",
        });
        setAttachmentFile(optimizedFile);
      } else {
        setAttachmentFile(file);
      }
    } catch (error) {
      console.error("Error processing file:", error);
      toast.error("Failed to process file");
    }
  };

  // Handle camera capture
  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachmentPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Optimize the captured image
      const optimized = await optimizeImage(file);
      const optimizedFile = new File([optimized], `bill_${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      setAttachmentFile(optimizedFile);
    } catch (error) {
      console.error("Error processing camera capture:", error);
      toast.error("Failed to process image");
    }
  };

  // Upload file to server
  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("is_private", "1");
      formData.append("doctype", "Purchase Invoice");

      const response = await fetch("/api/method/upload_file", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await response.json();
      if (data.message?.file_url) {
        return data.message.file_url;
      }
      return null;
    } catch (error) {
      console.error("Error uploading file:", error);
      return null;
    }
  };

  // Clear attachment
  const clearAttachment = () => {
    setAttachmentFile(null);
    setAttachmentPreview(null);
    setUploadedFileUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  // Complete purchase
  const handleCompletePurchase = async () => {
    setIsProcessing(true);

    try {
      // Upload attachment if present
      let fileUrl = uploadedFileUrl;
      if (attachmentFile && !fileUrl) {
        fileUrl = await uploadFile(attachmentFile);
        setUploadedFileUrl(fileUrl);
      }

      // Prepare invoice data
      const invoiceData: CreatePurchaseInvoiceData = {
        supplier: { id: selectedSupplier.id },
        items: cartItems.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          purchase_price: item.purchase_price,
          selling_price: item.selling_price,
          original_purchase_price: item.original_purchase_price,
          original_selling_price: item.original_selling_price,
          uom: item.uom,
          batch: item.batch,
          serial: item.serial,
        })),
        paymentMethods: isCreditPurchase
          ? []
          : paymentMethods.filter((pm) => pm.amount > 0),
        isCreditPurchase,
        taxTemplate: selectedTaxTemplate || undefined,
        attachment: fileUrl ? { file_url: fileUrl } : undefined,
      };

      // Create purchase invoice
      const response = await fetch("/api/method/klik_pos.api.purchase_invoice.create_purchase_invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: invoiceData }),
        credentials: "include",
      });

      const result = await response.json();

      if (result.message?.success) {
        setCreatedInvoice(result.message.invoice_name);
        setIsComplete(true);
        toast.success(`Purchase Invoice ${result.message.invoice_name} created successfully!`);
        
        // Clear cart immediately on success
        onCompletePayment();
        
        // Refresh stock data - use both methods to ensure update
        try {
          // First try refreshStockOnly for quick update
          if (refreshStockOnly) {
            await refreshStockOnly();
          }
          // Then do a full refetch to ensure all data is current
          if (refetchProducts) {
            await refetchProducts();
          }
        } catch (refreshError) {
          console.error("Error refreshing stock:", refreshError);
        }
      } else {
        throw new Error(result.message?.error || "Failed to create purchase invoice");
      }
    } catch (error) {
      console.error("Error creating purchase invoice:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create purchase invoice");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle close
  const handleClose = () => {
    // Note: onCompletePayment is already called immediately on success
    // so we don't need to call it again here
    onClose(isComplete);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-center">
            <Truck size={24} className="text-amber-600 mr-3" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Purchase Payment Processing
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {/* Left Panel - Payment Options */}
          <div className="flex-1 overflow-y-auto p-6 border-r border-gray-200 dark:border-gray-700">
            {isComplete ? (
              // Success State
              <div className="flex flex-col items-center justify-center h-full">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                  <Check size={40} className="text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  Purchase Complete!
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-2">
                  Invoice: {createdInvoice}
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center">
                  Stock has been updated. Prices will reflect the new values.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-6 px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                >
                  New Purchase
                </button>
              </div>
            ) : (
              <>
                {/* Credit Purchase Toggle */}
                <div className="mb-6">
                  <label className="flex items-center p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isCreditPurchase}
                      onChange={(e) => setIsCreditPurchase(e.target.checked)}
                      className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                    />
                    <div className="ml-3">
                      <span className="font-medium text-gray-900 dark:text-white">
                        Credit Purchase
                      </span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Stock will be updated, invoice created, but payment will be marked as unpaid
                      </p>
                    </div>
                  </label>
                </div>

                {/* Payment Methods */}
                {!isCreditPurchase && (
                  <div className="mb-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                      Payment Methods
                    </h3>
                    <div className="space-y-3">
                      {paymentMethods.map((pm, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <select
                            value={pm.mode_of_payment}
                            onChange={(e) => {
                              setPaymentMethods((prev) => {
                                const updated = [...prev];
                                updated[index].mode_of_payment = e.target.value;
                                return updated;
                              });
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          >
                            {availablePaymentModes.map((mode) => (
                              <option key={mode.name} value={mode.name}>
                                {mode.name}
                              </option>
                            ))}
                          </select>
                          <div className="relative w-32">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                              {currency_symbol}
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={pm.amount || ""}
                              onChange={(e) =>
                                updatePaymentAmount(index, parseFloat(e.target.value) || 0)
                              }
                              placeholder="0.00"
                              className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                          </div>
                          {paymentMethods.length > 1 && (
                            <button
                              onClick={() => removePaymentMethod(index)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={addPaymentMethod}
                        className="text-sm text-amber-600 hover:text-amber-700"
                      >
                        + Add Payment Method
                      </button>
                    </div>
                  </div>
                )}

                {/* Bill Attachment */}
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
                    Bill / Receipt Attachment (Optional)
                  </h3>
                  
                  {attachmentPreview ? (
                    <div className="relative">
                      <img
                        src={attachmentPreview}
                        alt="Bill preview"
                        className="w-full max-h-48 object-contain rounded-lg border border-gray-200 dark:border-gray-700"
                      />
                      <button
                        onClick={clearAttachment}
                        className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors"
                      >
                        <Upload size={20} className="text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Upload File
                        </span>
                      </button>
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors"
                      >
                        <Camera size={20} className="text-gray-400" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Take Photo
                        </span>
                      </button>
                    </div>
                  )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCameraCapture}
                    className="hidden"
                  />
                </div>

                {/* Payment Summary */}
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                      <span className="text-gray-900 dark:text-white">
                        {currency_symbol}
                        {subtotal.toFixed(2)}
                      </span>
                    </div>
                    {taxAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Tax</span>
                        <span className="text-gray-900 dark:text-white">
                          {currency_symbol}
                          {taxAmount.toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold border-t border-gray-200 dark:border-gray-600 pt-2 mt-2">
                      <span className="text-gray-900 dark:text-white">Total</span>
                      <span className="text-amber-600 dark:text-amber-400">
                        {currency_symbol}
                        {grandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Complete Button */}
                <button
                  onClick={handleCompletePurchase}
                  disabled={isProcessing}
                  className="w-full mt-6 py-3 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Check size={20} />
                      Complete Purchase {currency_symbol}
                      {grandTotal.toFixed(2)}
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Right Panel - Preview */}
          <div className="w-96 bg-gray-50 dark:bg-gray-900 overflow-y-auto p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 text-center">
              Purchase Summary
            </h3>

            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-600">
              {/* Supplier Info */}
              <div className="text-center border-b border-gray-200 dark:border-gray-700 pb-3 mb-3">
                <h4 className="font-bold text-gray-900 dark:text-white">
                  Purchase Invoice
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date().toLocaleString()}
                </p>
              </div>

              {/* Supplier Details */}
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {selectedSupplier.supplier_name}
                </p>
                {selectedSupplier.contact?.phone && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedSupplier.contact.phone}
                  </p>
                )}
              </div>

              {/* Items */}
              <div className="space-y-2 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex justify-between text-xs">
                    <div className="flex-1">
                      <p className="text-gray-900 dark:text-white font-medium">
                        {item.name}
                      </p>
                      <p className="text-gray-500 dark:text-gray-400">
                        {item.quantity} x {currency_symbol}
                        {item.purchase_price.toFixed(2)}
                      </p>
                    </div>
                    <p className="text-gray-900 dark:text-white font-medium">
                      {currency_symbol}
                      {(item.quantity * item.purchase_price).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                  <span className="text-gray-900 dark:text-white">
                    {currency_symbol}
                    {subtotal.toFixed(2)}
                  </span>
                </div>
                {taxAmount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">Tax</span>
                    <span className="text-gray-900 dark:text-white">
                      {currency_symbol}
                      {taxAmount.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-200 dark:border-gray-600">
                  <span className="text-gray-900 dark:text-white">Total</span>
                  <span className="text-amber-600 dark:text-amber-400">
                    {currency_symbol}
                    {grandTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Payment Method Info */}
              {!isCreditPurchase && paymentMethods.some((pm) => pm.amount > 0) && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                    Payment Methods:
                  </p>
                  {paymentMethods
                    .filter((pm) => pm.amount > 0)
                    .map((pm, index) => (
                      <div key={index} className="flex justify-between text-xs">
                        <span className="text-gray-600 dark:text-gray-400">
                          {pm.mode_of_payment}
                        </span>
                        <span className="text-gray-900 dark:text-white">
                          {currency_symbol}
                          {pm.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              {isCreditPurchase && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium text-center">
                    Credit Purchase - Payment Pending
                  </p>
                </div>
              )}

              {/* Attached Bill Preview */}
              {attachmentPreview && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <ImageIcon size={12} />
                    Attached Bill:
                  </p>
                  <img
                    src={attachmentPreview}
                    alt="Attached bill"
                    className="w-full h-24 object-contain rounded border border-gray-200 dark:border-gray-700"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
