"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, CheckCircle, AlertCircle, Camera, Flashlight } from 'lucide-react'
import Quagga from '@ericblade/quagga2'

interface BarcodeScannerModalProps {
  onBarcodeDetected: (barcode: string) => void
  onClose: () => void
  isOpen: boolean
}

export default function BarcodeScannerModal({ onBarcodeDetected, onClose, isOpen }: BarcodeScannerModalProps) {
  const [manualBarcode, setManualBarcode] = useState('')
  const [success, setSuccess] = useState(false)
  const [scannedBarcode, setScannedBarcode] = useState('')
  const [error, setError] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const scannerRef = useRef<HTMLDivElement>(null)
  const lastDetectedRef = useRef<string>('')
  const detectionCountRef = useRef<number>(0)
  const isInitializedRef = useRef<boolean>(false)

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && manualBarcode.trim()) {
      e.preventDefault()
      handleBarcodeSuccess(manualBarcode.trim())
    }
  }

  const handleBarcodeSuccess = useCallback((barcode: string) => {
    // Prevent duplicate processing
    if (success) return
    
    setScannedBarcode(barcode)
    setSuccess(true)
    
    // Stop scanning
    try {
      Quagga.stop()
    } catch (e) {
      // Ignore
    }
    setIsScanning(false)

    setTimeout(() => {
      onBarcodeDetected(barcode)
      setManualBarcode('')
      setSuccess(false)
      setScannedBarcode('')
      onClose()
    }, 800)
  }, [success, onBarcodeDetected, onClose])

  const stopScanner = useCallback(() => {
    try {
      Quagga.stop()
      Quagga.offDetected()
      Quagga.offProcessed()
    } catch (e) {
      // Ignore errors when stopping
    }
    setIsScanning(false)
    isInitializedRef.current = false
    lastDetectedRef.current = ''
    detectionCountRef.current = 0
  }, [])

  const startScanner = useCallback(async () => {
    if (!scannerRef.current || isInitializedRef.current) return
    
    setError('')
    lastDetectedRef.current = ''
    detectionCountRef.current = 0

    try {
      // First check camera permissions
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      })
      
      // Check for torch capability
      const track = stream.getVideoTracks()[0]
      if (track) {
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean }
        setHasTorch(!!capabilities.torch)
      }
      
      // Stop the test stream
      stream.getTracks().forEach(t => t.stop())

      // Initialize Quagga2
      Quagga.init({
        inputStream: {
          name: "Live",
          type: "LiveStream",
          target: scannerRef.current,
          constraints: {
            facingMode: "environment",
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 },
            aspectRatio: { ideal: 1.333 }
          },
          area: {
            top: "20%",
            right: "10%",
            left: "10%",
            bottom: "20%"
          },
          singleChannel: false
        },
        locator: {
          patchSize: "medium",
          halfSample: true
        },
        numOfWorkers: navigator.hardwareConcurrency || 4,
        frequency: 10,
        decoder: {
          readers: [
            "ean_reader",
            "ean_8_reader",
            "upc_reader",
            "upc_e_reader",
            "code_128_reader",
            "code_39_reader",
            "code_93_reader",
            "codabar_reader",
            "i2of5_reader"
          ],
          multiple: false
        },
        locate: true
      }, (err) => {
        if (err) {
          console.error('Quagga init error:', err)
          if (err.message?.includes('Permission') || err.name === 'NotAllowedError') {
            setError('Camera access denied. Please allow camera permission and try again.')
          } else {
            setError('Failed to start camera. Please use manual input.')
          }
          return
        }

        isInitializedRef.current = true
        setIsScanning(true)
        Quagga.start()
      })

      // Handle barcode detection with confidence checking
      Quagga.onDetected((result) => {
        if (!result?.codeResult?.code) return

        const code = result.codeResult.code
        const errors = result.codeResult.decodedCodes
          ?.filter((d: { error?: number }) => d.error !== undefined)
          ?.map((d: { error?: number }) => d.error) || []
        
        // Calculate average error rate
        const avgError = errors.length > 0 
          ? errors.reduce((a: number, b: number) => a + b, 0) / errors.length 
          : 1

        // Only accept high-confidence reads (lower error = better)
        if (avgError < 0.15) {
          // Require consistent readings for reliability
          if (lastDetectedRef.current === code) {
            detectionCountRef.current++
            if (detectionCountRef.current >= 2) {
              handleBarcodeSuccess(code)
            }
          } else {
            lastDetectedRef.current = code
            detectionCountRef.current = 1
          }
        }
      })

      // Draw detection boxes for visual feedback
      Quagga.onProcessed((result) => {
        const drawingCtx = Quagga.canvas.ctx.overlay
        const drawingCanvas = Quagga.canvas.dom.overlay

        if (!drawingCtx || !drawingCanvas) return

        // Clear canvas
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height)

        if (result) {
          // Draw boxes around detected barcodes
          if (result.boxes) {
            result.boxes.filter((box: number[][]) => box !== result.box).forEach((box: number[][]) => {
              drawingCtx.strokeStyle = 'rgba(0, 255, 0, 0.5)'
              drawingCtx.lineWidth = 2
              Quagga.ImageDebug.drawPath(box, { x: 0, y: 1 }, drawingCtx, { color: 'rgba(0, 255, 0, 0.5)', lineWidth: 2 })
            })
          }

          // Highlight the main detected barcode
          if (result.box) {
            drawingCtx.strokeStyle = '#00FF00'
            drawingCtx.lineWidth = 3
            Quagga.ImageDebug.drawPath(result.box, { x: 0, y: 1 }, drawingCtx, { color: '#00FF00', lineWidth: 3 })
          }

          // Draw the scan line
          if (result.line) {
            drawingCtx.strokeStyle = '#FF0000'
            drawingCtx.lineWidth = 3
            Quagga.ImageDebug.drawPath(result.line, { x: 0, y: 1 }, drawingCtx, { color: '#FF0000', lineWidth: 3 })
          }
        }
      })

    } catch (err) {
      console.error('Camera error:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (errorMessage.includes('Permission') || errorMessage.includes('NotAllowed')) {
        setError('Camera access denied. Please allow camera permission in your browser settings.')
      } else if (errorMessage.includes('NotFound') || errorMessage.includes('DevicesNotFound')) {
        setError('No camera found. Please use manual input.')
      } else {
        setError('Camera not available. Please use manual input.')
      }
    }
  }, [handleBarcodeSuccess])

  const toggleTorch = async () => {
    try {
      const track = Quagga.CameraAccess.getActiveTrack()
      if (track) {
        await track.applyConstraints({
          advanced: [{ torch: !torchOn } as MediaTrackConstraintSet]
        })
        setTorchOn(!torchOn)
      }
    } catch (e) {
      console.error('Torch toggle error:', e)
    }
  }

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        startScanner()
      }, 100)
      return () => clearTimeout(timer)
    } else {
      stopScanner()
    }
  }, [isOpen, startScanner, stopScanner])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [stopScanner])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg mx-auto flex flex-col max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Scan Barcode
          </h3>
          <div className="flex items-center gap-2">
            {hasTorch && isScanning && (
              <button
                onClick={toggleTorch}
                className={`p-2 rounded-lg transition-colors ${
                  torchOn 
                    ? 'bg-yellow-500 text-white' 
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
                title="Toggle flashlight"
              >
                <Flashlight size={20} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Success Message */}
          {success && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center">
                <CheckCircle className="text-green-600 dark:text-green-400 mr-2 shrink-0" size={20} />
                <div className="min-w-0">
                  <span className="text-green-800 dark:text-green-200 font-medium block truncate">
                    {scannedBarcode}
                  </span>
                  <p className="text-green-600 dark:text-green-400 text-sm">
                    Adding to cart...
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start">
                <AlertCircle className="text-red-600 dark:text-red-400 mr-2 shrink-0 mt-0.5" size={20} />
                <span className="text-red-800 dark:text-red-200 text-sm">
                  {error}
                </span>
              </div>
            </div>
          )}

          {/* Scanner View */}
          <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
            <div 
              ref={scannerRef} 
              className="w-full h-full"
              style={{ 
                position: 'relative',
                minHeight: '240px'
              }}
            />
            
            {/* Scanning overlay */}
            {isScanning && !success && (
              <>
                {/* Corner markers */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-[20%] left-[10%] w-8 h-8 border-t-3 border-l-3 border-green-400" style={{ borderWidth: '3px 0 0 3px' }} />
                  <div className="absolute top-[20%] right-[10%] w-8 h-8 border-t-3 border-r-3 border-green-400" style={{ borderWidth: '3px 3px 0 0' }} />
                  <div className="absolute bottom-[20%] left-[10%] w-8 h-8 border-b-3 border-l-3 border-green-400" style={{ borderWidth: '0 0 3px 3px' }} />
                  <div className="absolute bottom-[20%] right-[10%] w-8 h-8 border-b-3 border-r-3 border-green-400" style={{ borderWidth: '0 3px 3px 0' }} />
                </div>
                
                {/* Scanning line animation */}
                <div className="absolute left-[10%] right-[10%] top-[20%] bottom-[20%] pointer-events-none overflow-hidden">
                  <div className="w-full h-0.5 bg-red-500 animate-scan-line" />
                </div>

                {/* Status indicator */}
                <div className="absolute top-3 left-3 bg-black/70 text-white px-3 py-1.5 rounded-full text-sm flex items-center">
                  <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse" />
                  Scanning...
                </div>
              </>
            )}

            {/* No camera placeholder */}
            {!isScanning && !success && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <Camera size={48} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Camera initializing...</p>
                </div>
              </div>
            )}
          </div>

          {/* Instructions */}
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {isScanning 
              ? "Position barcode within the frame"
              : "Use manual input below"
            }
          </p>

          {/* Manual Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Manual Entry
            </label>
            <input
              type="text"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type barcode and press Enter..."
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
              autoComplete="off"
              inputMode="numeric"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>
              Supports: EAN-13, UPC-A, Code128, Code39
            </span>
            <span className={isScanning ? 'text-green-500' : 'text-gray-400'}>
              {isScanning ? '● Active' : '○ Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* CSS for scan line animation */}
      <style>{`
        @keyframes scan-line {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(calc(100% - 2px)); }
        }
        .animate-scan-line {
          animation: scan-line 2s ease-in-out infinite;
        }
        
        /* Ensure Quagga video fills container */
        .drawingBuffer {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
        }
        
        video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        
        canvas.drawingBuffer {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  )
}
