"use client"

import { useState } from "react"
import { X, Printer, Minus, Plus } from "lucide-react"
import { toast } from "react-toastify"

interface BarcodePrintDialogProps {
  isOpen: boolean
  onClose: () => void
  barcode: string
  itemName: string
  itemCode: string
  sellingPrice?: number
}

export default function BarcodePrintDialog({
  isOpen,
  onClose,
  barcode,
  itemName,
  itemCode,
  sellingPrice
}: BarcodePrintDialogProps) {
  const [copies, setCopies] = useState(1)
  const [isPrinting, setIsPrinting] = useState(false)

  // Generate barcode image URL using bwipjs API (same as Jinja template)
  const getBarcodeImageUrl = (barcodeText: string): string => {
    return `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(barcodeText)}&scale=2&height=10&includetext=false`
  }

  // Handle browser print using the exact structure from Jinja template
  const handlePrint = () => {
    if (!barcode) {
      toast.error('Barcode is required')
      return
    }

    setIsPrinting(true)
    
    // Create print content using the exact structure from the working Jinja template
    const printWindow = window.open('', '_blank', 'width=600,height=400')
    if (!printWindow) {
      toast.error('Please allow pop-ups to print barcodes')
      setIsPrinting(false)
      return
    }

    const barcodeImageUrl = getBarcodeImageUrl(barcode)
    const truncatedName = itemName.substring(0, 20) // Truncate to 20 chars as in Jinja template

    // Create labels HTML - one label per copy
    let labelsHtml = ''
    for (let i = 0; i < copies; i++) {
      labelsHtml += `
        <div class="label-container">
          <!-- Item Name (Truncated to 20 chars) -->
          <div class="item-name">
            ${truncatedName}
          </div>

          <!-- The Barcode Image -->
          <div class="barcode-box">
            <img class="barcode-img" 
                 src="${barcodeImageUrl}" 
                 alt="Barcode ${barcode}" />
            
            <!-- The Barcode Number (Text below image) -->
            <div class="barcode-text">${barcode}</div>
          </div>
        </div>
      `
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Barcode - ${itemName}</title>
        <style>
          /* CSS for 50mm x 30mm Label - Exact from Jinja template */
          body {
            margin: 0;
            padding: 0;
          }
          
          .label-container {
            /* ADJUST THESE if your paper is different (e.g. 40mm x 25mm) */
            width: 50mm; 
            height: 30mm;
            
            overflow: hidden;
            text-align: center;
            font-family: sans-serif;
            /* Critical: Forces printer to start new label after this div */
            page-break-after: always; 
            background-color: white;
          }

          .item-name {
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap; /* Keeps name on one line */
            margin-top: 3px;
          }

          .barcode-box {
            margin-top: 2px;
          }

          .barcode-img {
            width: 90%; 
            height: 12mm; /* Height of the bars */
            object-fit: contain;
          }

          .barcode-text {
            font-size: 10px;
            letter-spacing: 1px;
            margin-top: -2px;
          }

          .price {
            font-size: 11px;
            font-weight: bold;
            margin-top: 2px;
          }
          
          .no-code {
            font-size: 10px;
            color: red;
            margin-top: 10px;
          }

          @media print {
            .label-container {
              border: none !important;
            }
          }

          @media screen {
            .label-container {
              border: 0.5mm dashed #ccc;
              margin-bottom: 2mm;
            }
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 300);
          }
        </script>
      </body>
      </html>
    `)
    
    printWindow.document.close()
    setIsPrinting(false)
    toast.success(`Printing ${copies} label${copies > 1 ? 's' : ''}...`)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
            <Printer size={20} className="mr-2 text-beveren-600" />
            Print Barcode Labels
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Item Info */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{itemName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Code: {itemCode}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">Barcode: {barcode}</p>
          </div>

          {/* Barcode Preview - Using same structure as Jinja template */}
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-white">
            <p className="text-xs text-gray-500 mb-2 text-center">Preview</p>
            <div 
              className="label-container mx-auto"
              style={{ 
                width: '150px', 
                height: '90px',
                border: '1px dashed #ccc'
              }}
            >
              <div className="item-name" style={{ fontSize: '8px', marginTop: '2px' }}>
                {itemName.substring(0, 20)}
              </div>
              <div className="barcode-box" style={{ marginTop: '2px' }}>
                <img 
                  className="barcode-img" 
                  src={getBarcodeImageUrl(barcode)}
                  alt={`Barcode ${barcode}`}
                  style={{ width: '90%', height: '36px', objectFit: 'contain' }}
                />
                <div className="barcode-text" style={{ fontSize: '8px', letterSpacing: '1px', marginTop: '-2px' }}>
                  {barcode}
                </div>
              </div>
            </div>
          </div>

          {/* Number of Copies */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Number of Labels
            </label>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setCopies(Math.max(1, copies - 1))}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Minus size={18} />
              </button>
              <input
                type="number"
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="w-20 px-3 py-2 text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                min={1}
                max={100}
              />
              <button
                type="button"
                onClick={() => setCopies(Math.min(100, copies + 1))}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting || !barcode}
              className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPrinting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Printing...</span>
                </>
              ) : (
                <>
                  <Printer size={18} />
                  <span>Print {copies} Label{copies > 1 ? 's' : ''}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
