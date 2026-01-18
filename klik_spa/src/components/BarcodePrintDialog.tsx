"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X, Printer, Minus, Plus, Settings, Info } from "lucide-react"
import JsBarcode from "jsbarcode"

interface BarcodePrintDialogProps {
  isOpen: boolean
  onClose: () => void
  barcode: string
  itemName: string
  itemCode: string
  sellingPrice?: number
}

// Deli 886BW Thermal Printer default specifications
const DELI_886BW_DEFAULTS = {
  labelWidth: 50,    // mm - common barcode label width
  labelHeight: 30,   // mm - common barcode label height
  maxWidth: 80,      // mm - max printable width
  minWidth: 20,      // mm - min label width
  maxHeight: 200,    // mm - max label length
  minHeight: 15,     // mm - min label length
  dpi: 203,          // dots per inch
}

// Convert mm to pixels at 203 DPI
const mmToPixels = (mm: number, dpi: number = 203): number => {
  return Math.round((mm / 25.4) * dpi)
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
  const [labelWidth, setLabelWidth] = useState(DELI_886BW_DEFAULTS.labelWidth)
  const [labelHeight, setLabelHeight] = useState(DELI_886BW_DEFAULTS.labelHeight)
  const [showPrice, setShowPrice] = useState(true)
  const [showName, setShowName] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  
  const previewRef = useRef<HTMLDivElement>(null)
  const barcodeRef = useRef<SVGSVGElement>(null)

  // Generate barcode preview
  const generateBarcode = useCallback(() => {
    if (barcodeRef.current && barcode) {
      try {
        JsBarcode(barcodeRef.current, barcode, {
          format: "CODE128",
          width: 2,
          height: 40,
          displayValue: true,
          fontSize: 12,
          margin: 5,
          background: "#ffffff",
          lineColor: "#000000"
        })
      } catch (err) {
        console.error("Error generating barcode:", err)
      }
    }
  }, [barcode])

  useEffect(() => {
    if (isOpen) {
      setTimeout(generateBarcode, 100)
    }
  }, [isOpen, generateBarcode])

  const handlePrint = () => {
    setIsPrinting(true)
    
    // Create print content
    const printWindow = window.open('', '_blank', 'width=600,height=400')
    if (!printWindow) {
      alert('Please allow pop-ups to print barcodes')
      setIsPrinting(false)
      return
    }

    // Calculate dimensions in mm for CSS
    const widthMM = labelWidth
    const heightMM = labelHeight
    
    // Generate barcode SVG
    const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    JsBarcode(tempSvg, barcode, {
      format: "CODE128",
      width: 2,
      height: Math.min(40, heightMM * 0.5),
      displayValue: true,
      fontSize: 10,
      margin: 2,
      background: "#ffffff",
      lineColor: "#000000"
    })
    const barcodeSvg = tempSvg.outerHTML

    // Create labels HTML
    let labelsHtml = ''
    for (let i = 0; i < copies; i++) {
      labelsHtml += `
        <div class="label" style="
          width: ${widthMM}mm;
          height: ${heightMM}mm;
          padding: 1mm;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          page-break-after: always;
          border: 0.1mm dashed #ccc;
          margin-bottom: 1mm;
        ">
          ${showName ? `<div style="font-size: 8px; font-weight: bold; text-align: center; margin-bottom: 1mm; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${itemName.substring(0, 30)}</div>` : ''}
          <div style="flex: 1; display: flex; align-items: center; justify-content: center; max-width: 100%; overflow: hidden;">
            ${barcodeSvg}
          </div>
          ${showPrice && sellingPrice ? `<div style="font-size: 10px; font-weight: bold; margin-top: 1mm;">Rs. ${sellingPrice.toFixed(2)}</div>` : ''}
        </div>
      `
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Barcode - ${itemName}</title>
        <style>
          @page {
            size: ${widthMM}mm ${heightMM}mm;
            margin: 0;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
          }
          .label {
            break-inside: avoid;
          }
          @media print {
            .label {
              border: none !important;
              margin-bottom: 0 !important;
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
            }, 250);
          }
        </script>
      </body>
      </html>
    `)
    
    printWindow.document.close()
    setIsPrinting(false)
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
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">Barcode: {barcode}</p>
          </div>

          {/* Barcode Preview */}
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-white">
            <p className="text-xs text-gray-500 mb-2 text-center">Preview</p>
            <div 
              ref={previewRef}
              className="flex flex-col items-center justify-center mx-auto"
              style={{ 
                width: `${labelWidth * 3}px`, 
                height: `${labelHeight * 3}px`,
                border: '1px dashed #ccc'
              }}
            >
              {showName && (
                <p className="text-[8px] font-bold text-center mb-1 truncate max-w-full px-1">
                  {itemName.substring(0, 30)}
                </p>
              )}
              <svg ref={barcodeRef} className="max-w-full"></svg>
              {showPrice && sellingPrice && (
                <p className="text-[10px] font-bold mt-1">Rs. {sellingPrice.toFixed(2)}</p>
              )}
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

          {/* Label Content Options */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showName}
                onChange={(e) => setShowName(e.target.checked)}
                className="w-4 h-4 text-beveren-600 rounded"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Show Item Name</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="w-4 h-4 text-beveren-600 rounded"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Show Price</span>
            </label>
          </div>

          {/* Advanced Settings */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center text-sm text-beveren-600 hover:text-beveren-700"
            >
              <Settings size={16} className="mr-1" />
              {showAdvanced ? 'Hide' : 'Show'} Label Size Settings
            </button>
            
            {showAdvanced && (
              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-3">
                <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mb-2">
                  <Info size={14} className="mr-1" />
                  <span>Deli 886BW: Width 20-80mm, Height 15-200mm</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Width (mm)
                    </label>
                    <input
                      type="number"
                      value={labelWidth}
                      onChange={(e) => setLabelWidth(Math.max(DELI_886BW_DEFAULTS.minWidth, Math.min(DELI_886BW_DEFAULTS.maxWidth, parseInt(e.target.value) || DELI_886BW_DEFAULTS.labelWidth)))}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      min={DELI_886BW_DEFAULTS.minWidth}
                      max={DELI_886BW_DEFAULTS.maxWidth}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                      Height (mm)
                    </label>
                    <input
                      type="number"
                      value={labelHeight}
                      onChange={(e) => setLabelHeight(Math.max(DELI_886BW_DEFAULTS.minHeight, Math.min(DELI_886BW_DEFAULTS.maxHeight, parseInt(e.target.value) || DELI_886BW_DEFAULTS.labelHeight)))}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      min={DELI_886BW_DEFAULTS.minHeight}
                      max={DELI_886BW_DEFAULTS.maxHeight}
                    />
                  </div>
                </div>
                
                {/* Preset sizes */}
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    Common Sizes
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { w: 40, h: 30, label: '40×30' },
                      { w: 50, h: 30, label: '50×30' },
                      { w: 60, h: 40, label: '60×40' },
                      { w: 70, h: 40, label: '70×40' },
                    ].map((size) => (
                      <button
                        key={size.label}
                        type="button"
                        onClick={() => {
                          setLabelWidth(size.w)
                          setLabelHeight(size.h)
                        }}
                        className={`px-2 py-1 text-xs rounded border ${
                          labelWidth === size.w && labelHeight === size.h
                            ? 'bg-beveren-600 text-white border-beveren-600'
                            : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {size.label}mm
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200 dark:border-gray-700">
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
            className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors disabled:opacity-50"
          >
            <Printer size={18} />
            <span>{isPrinting ? 'Preparing...' : `Print ${copies} Label${copies > 1 ? 's' : ''}`}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
