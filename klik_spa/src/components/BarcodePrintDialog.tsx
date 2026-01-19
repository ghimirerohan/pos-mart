"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X, Printer, Minus, Plus, Settings, Info, Usb, AlertCircle, CheckCircle, Loader2, RefreshCw } from "lucide-react"
import JsBarcode from "jsbarcode"
import { thermalPrinter } from "../services/thermalPrinterService"
import type { PrinterStatus } from "../services/thermalPrinterService"
import { toast } from "react-toastify"

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

/**
 * Detect barcode format based on pattern and length
 */
function detectBarcodeFormat(barcode: string): string {
  const clean = barcode.replace(/\s/g, '')
  const isNumeric = /^\d+$/.test(clean)

  if (isNumeric) {
    switch (clean.length) {
      case 8:
        // EAN-8
        return 'EAN8'
      case 12:
        // UPC-A
        return 'UPC'
      case 13:
        // EAN-13
        return 'EAN13'
      case 14:
        // ITF-14
        return 'ITF14'
    }
  }

  // Check for CODE39 pattern (alphanumeric with specific chars)
  if (/^[A-Z0-9\-\.\ \$\/\+\%\*]+$/i.test(clean) && clean.length <= 43) {
    return 'CODE39'
  }

  // Default to CODE128 (most versatile)
  return 'CODE128'
}

/**
 * Get JsBarcode options based on detected format
 */
function getBarcodeOptions(barcode: string, format: string) {
  const baseOptions = {
    displayValue: true,
    fontSize: 14,
    margin: 10,
    background: "#ffffff",
    lineColor: "#000000",
    textMargin: 2,
  }

  switch (format) {
    case 'EAN13':
      return {
        ...baseOptions,
        format: 'EAN13',
        width: 2,
        height: 50,
        flat: true,
      }
    case 'EAN8':
      return {
        ...baseOptions,
        format: 'EAN8',
        width: 2,
        height: 50,
        flat: true,
      }
    case 'UPC':
      return {
        ...baseOptions,
        format: 'UPC',
        width: 2,
        height: 50,
        flat: true,
      }
    case 'ITF14':
      return {
        ...baseOptions,
        format: 'ITF14',
        width: 2,
        height: 50,
      }
    case 'CODE39':
      return {
        ...baseOptions,
        format: 'CODE39',
        width: 1.5,
        height: 45,
      }
    case 'CODE128':
    default:
      return {
        ...baseOptions,
        format: 'CODE128',
        width: 2,
        height: 50,
      }
  }
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
  const [isConnecting, setIsConnecting] = useState(false)
  
  // Printer status
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>({
    connected: false,
    printerName: null,
    error: null
  })
  
  // Detected barcode format
  const [detectedFormat, setDetectedFormat] = useState<string>('CODE128')
  
  const previewRef = useRef<HTMLDivElement>(null)
  const barcodeRef = useRef<SVGSVGElement>(null)

  // Detect barcode format on barcode change
  useEffect(() => {
    if (barcode) {
      const format = detectBarcodeFormat(barcode)
      setDetectedFormat(format)
    }
  }, [barcode])

  // Check initial printer status
  useEffect(() => {
    if (isOpen) {
      setPrinterStatus(thermalPrinter.getStatus())
    }
  }, [isOpen])

  // Generate barcode preview with correct format
  const generateBarcode = useCallback(() => {
    if (barcodeRef.current && barcode) {
      try {
        const format = detectBarcodeFormat(barcode)
        const options = getBarcodeOptions(barcode, format)
        
        JsBarcode(barcodeRef.current, barcode, {
          ...options,
          height: 40,
          fontSize: 12,
          margin: 5,
        })
      } catch (err) {
        console.error("Error generating barcode:", err)
        // Fallback to CODE128 if specific format fails
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
        } catch (fallbackErr) {
          console.error("Fallback barcode generation failed:", fallbackErr)
        }
      }
    }
  }, [barcode])

  useEffect(() => {
    if (isOpen) {
      setTimeout(generateBarcode, 100)
    }
  }, [isOpen, generateBarcode, detectedFormat])

  // Connect to printer
  const handleConnectPrinter = async () => {
    setIsConnecting(true)
    try {
      const status = await thermalPrinter.connect()
      setPrinterStatus(status)
      
      if (status.connected) {
        toast.success(`Connected to ${status.printerName}`)
      } else if (status.error) {
        toast.error(status.error)
      }
    } catch (err) {
      console.error('Printer connection error:', err)
      toast.error('Failed to connect to printer')
    } finally {
      setIsConnecting(false)
    }
  }

  // Disconnect printer
  const handleDisconnectPrinter = async () => {
    await thermalPrinter.disconnect()
    setPrinterStatus({
      connected: false,
      printerName: null,
      error: null
    })
    toast.info('Printer disconnected')
  }

  // Direct print to thermal printer
  const handleDirectPrint = async () => {
    if (!printerStatus.connected) {
      toast.error('Please connect to a printer first')
      return
    }

    setIsPrinting(true)

    try {
      // Try TSPL first (more common for label printers), fall back to ESC/POS
      let result = await thermalPrinter.printLabelsTSPL(
        {
          barcode,
          itemName,
          price: sellingPrice
        },
        {
          width: labelWidth,
          height: labelHeight,
          copies,
          showName,
          showPrice
        }
      )

      // If TSPL fails, try ESC/POS
      if (!result.success) {
        result = await thermalPrinter.printLabels(
          {
            barcode,
            itemName,
            price: sellingPrice
          },
          {
            width: labelWidth,
            height: labelHeight,
            copies,
            showName,
            showPrice
          }
        )
      }

      if (result.success) {
        toast.success(`Printed ${copies} label${copies > 1 ? 's' : ''} successfully!`)
        onClose()
      } else {
        toast.error(result.error || 'Print failed')
      }
    } catch (err) {
      console.error('Print error:', err)
      toast.error('Print failed. Please check printer connection.')
      setPrinterStatus(prev => ({ ...prev, connected: false }))
    } finally {
      setIsPrinting(false)
    }
  }

  // Fallback browser print (if USB fails)
  const handleBrowserPrint = () => {
    setIsPrinting(true)
    
    // Create print content
    const printWindow = window.open('', '_blank', 'width=600,height=400')
    if (!printWindow) {
      toast.error('Please allow pop-ups to print barcodes')
      setIsPrinting(false)
      return
    }

    const format = detectBarcodeFormat(barcode)
    const options = getBarcodeOptions(barcode, format)
    
    // Generate barcode SVG
    const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    try {
      JsBarcode(tempSvg, barcode, {
        ...options,
        height: Math.min(50, labelHeight * 0.6),
        margin: 2,
      })
    } catch {
      // Fallback
      JsBarcode(tempSvg, barcode, {
        format: "CODE128",
        width: 2,
        height: Math.min(50, labelHeight * 0.6),
        displayValue: true,
        margin: 2,
      })
    }
    const barcodeSvg = tempSvg.outerHTML

    // Create labels HTML
    let labelsHtml = ''
    for (let i = 0; i < copies; i++) {
      labelsHtml += `
        <div class="label">
          ${showName ? `<div class="item-name">${itemName.substring(0, 30)}</div>` : ''}
          <div class="barcode-container">
            ${barcodeSvg}
          </div>
          ${showPrice && sellingPrice ? `<div class="price">Rs. ${sellingPrice.toFixed(2)}</div>` : ''}
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
            size: ${labelWidth}mm ${labelHeight}mm;
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
            width: ${labelWidth}mm;
            height: ${labelHeight}mm;
            padding: 1mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            page-break-after: always;
            break-inside: avoid;
          }
          .item-name {
            font-size: 8pt;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1mm;
            max-width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }
          .barcode-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            max-width: 100%;
          }
          .barcode-container svg {
            max-width: 100%;
            height: auto;
          }
          .price {
            font-size: 10pt;
            font-weight: bold;
            margin-top: 1mm;
          }
          @media print {
            .label {
              border: none !important;
            }
          }
          @media screen {
            .label {
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
  }

  if (!isOpen) return null

  const isWebUSBSupported = thermalPrinter.isSupported()

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
          {/* Printer Connection Status */}
          {isWebUSBSupported && (
            <div className={`rounded-lg p-3 ${
              printerStatus.connected 
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' 
                : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {printerStatus.connected ? (
                    <>
                      <CheckCircle size={18} className="text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-800 dark:text-green-200">
                          {printerStatus.printerName}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400">Ready to print</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Usb size={18} className="text-amber-600" />
                      <div>
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                          No printer connected
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Connect your Deli thermal printer via USB
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={printerStatus.connected ? handleDisconnectPrinter : handleConnectPrinter}
                  disabled={isConnecting}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    printerStatus.connected
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                      : 'bg-beveren-600 text-white hover:bg-beveren-700'
                  }`}
                >
                  {isConnecting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : printerStatus.connected ? (
                    'Disconnect'
                  ) : (
                    'Connect'
                  )}
                </button>
              </div>
              {printerStatus.error && (
                <div className="mt-2 flex items-start space-x-1 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{printerStatus.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Item Info */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{itemName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Code: {itemCode}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">Barcode: {barcode}</p>
              <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-medium">
                {detectedFormat}
              </span>
            </div>
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
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          {/* Direct Print Button (Primary) */}
          {isWebUSBSupported && (
            <button
              type="button"
              onClick={handleDirectPrint}
              disabled={isPrinting || !barcode || !printerStatus.connected}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPrinting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Printer size={18} />
              )}
              <span>
                {isPrinting 
                  ? 'Printing...' 
                  : !printerStatus.connected 
                    ? 'Connect Printer to Print' 
                    : `Print ${copies} Label${copies > 1 ? 's' : ''}`
                }
              </span>
            </button>
          )}

          {/* Browser Print Fallback */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            
            {!isWebUSBSupported ? (
              <button
                type="button"
                onClick={handleBrowserPrint}
                disabled={isPrinting || !barcode}
                className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors disabled:opacity-50"
              >
                <Printer size={18} />
                <span>Print via Browser</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBrowserPrint}
                disabled={isPrinting || !barcode}
                className="flex items-center space-x-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm"
              >
                <RefreshCw size={16} />
                <span>Use Browser Print</span>
              </button>
            )}
          </div>
          
          {!isWebUSBSupported && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center flex items-center justify-center">
              <AlertCircle size={12} className="mr-1" />
              Direct USB printing requires Chrome or Edge browser
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
