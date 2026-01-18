import { useEffect, useCallback, useRef } from 'react'

interface UseUSBBarcodeScannerOptions {
  onBarcodeScanned: (barcode: string) => void
  enabled?: boolean
  minLength?: number
  maxTimeBetweenChars?: number // milliseconds
  endKey?: string
}

/**
 * Hook to detect USB barcode scanner input.
 * 
 * USB barcode scanners work as keyboard emulation devices - they "type" the barcode
 * very rapidly followed by an Enter key. This hook detects this pattern by:
 * 1. Tracking rapid keystrokes (faster than human typing)
 * 2. Detecting Enter key as the end signal
 * 3. Validating the accumulated input as a potential barcode
 */
export function useUSBBarcodeScanner({
  onBarcodeScanned,
  enabled = true,
  minLength = 4,
  maxTimeBetweenChars = 50, // USB scanners typically input at <30ms per char
  endKey = 'Enter'
}: UseUSBBarcodeScannerOptions) {
  const bufferRef = useRef<string>('')
  const lastKeyTimeRef = useRef<number>(0)
  const isCapturingRef = useRef<boolean>(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const resetBuffer = useCallback(() => {
    bufferRef.current = ''
    isCapturingRef.current = false
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return

    const now = Date.now()
    const timeSinceLastKey = now - lastKeyTimeRef.current
    lastKeyTimeRef.current = now

    // Check if we should process this as scanner input
    const target = event.target as HTMLElement
    const isInputField = target.tagName === 'INPUT' || 
                         target.tagName === 'TEXTAREA' || 
                         target.isContentEditable

    // If the end key is pressed
    if (event.key === endKey) {
      const barcode = bufferRef.current.trim()
      
      // Validate barcode
      if (barcode.length >= minLength && isCapturingRef.current) {
        // Prevent default behavior (form submission, etc.)
        event.preventDefault()
        event.stopPropagation()
        
        // Clear any focused input if barcode is valid
        if (isInputField && barcode.length >= 8) {
          (target as HTMLInputElement).value = ''
        }
        
        // Trigger the callback
        onBarcodeScanned(barcode)
        resetBuffer()
        return
      }
      
      // Reset if not a valid barcode
      resetBuffer()
      return
    }

    // Ignore modifier keys and special keys
    if (event.ctrlKey || event.altKey || event.metaKey || event.key.length > 1) {
      // Reset if a non-character key is pressed (except Enter)
      if (event.key !== 'Shift') {
        resetBuffer()
      }
      return
    }

    // Check timing for scanner detection
    const isRapidInput = timeSinceLastKey < maxTimeBetweenChars
    
    // Start capturing if this looks like scanner input
    if (!isCapturingRef.current) {
      // First character - start potential barcode capture
      bufferRef.current = event.key
      isCapturingRef.current = true
    } else if (isRapidInput) {
      // Continue capturing rapid input
      bufferRef.current += event.key
    } else {
      // Too slow - this is manual typing, reset
      bufferRef.current = event.key
    }

    // Set a timeout to reset the buffer if no more input comes
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      resetBuffer()
    }, 200) // Reset after 200ms of no input

    // If we're capturing scanner input in a focused input field,
    // prevent the character from being typed (we'll handle it)
    if (isCapturingRef.current && isInputField && bufferRef.current.length >= 4) {
      // Only prevent if it looks like scanner input (rapid, numeric or alphanumeric)
      if (/^[A-Za-z0-9-]+$/.test(bufferRef.current)) {
        // Let the first few characters through, but prevent after we're sure it's a scanner
        if (bufferRef.current.length >= 8) {
          event.preventDefault()
        }
      }
    }
  }, [enabled, minLength, maxTimeBetweenChars, endKey, onBarcodeScanned, resetBuffer])

  useEffect(() => {
    if (!enabled) return

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [enabled, handleKeyDown])

  return {
    resetBuffer
  }
}
