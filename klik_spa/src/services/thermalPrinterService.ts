/**
 * Thermal Printer Service for Deli 886BW and similar USB thermal label printers
 * Uses WebUSB API for direct USB communication with ESC/POS commands
 */

// ESC/POS Command Constants
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

// Deli USB Vendor/Product IDs (common IDs for thermal printers)
const KNOWN_PRINTER_FILTERS = [
  { vendorId: 0x0416 }, // Winbond (common for Chinese thermal printers)
  { vendorId: 0x0483 }, // STMicroelectronics
  { vendorId: 0x0525 }, // Netchip Technology
  { vendorId: 0x1fc9 }, // NXP (used by many label printers)
  { vendorId: 0x20d1 }, // Deli specific
  { vendorId: 0x28e9 }, // GD32 (common MCU in printers)
  { vendorId: 0x1a86 }, // QinHeng Electronics (CH340/CH341)
  { vendorId: 0x067b }, // Prolific (USB-Serial)
]

export interface PrinterStatus {
  connected: boolean
  printerName: string | null
  error: string | null
}

export interface LabelConfig {
  width: number      // mm
  height: number     // mm
  copies: number
  showName: boolean
  showPrice: boolean
}

export interface LabelData {
  barcode: string
  itemName: string
  price?: number
}

class ThermalPrinterService {
  private device: USBDevice | null = null
  private interfaceNumber: number = 0
  private endpointOut: number = 0
  private isConnected: boolean = false

  /**
   * Check if WebUSB is supported
   */
  isSupported(): boolean {
    return 'usb' in navigator
  }

  /**
   * Get current printer status
   */
  getStatus(): PrinterStatus {
    return {
      connected: this.isConnected,
      printerName: this.device?.productName || null,
      error: null
    }
  }

  /**
   * Request and connect to a thermal printer
   */
  async connect(): Promise<PrinterStatus> {
    if (!this.isSupported()) {
      return {
        connected: false,
        printerName: null,
        error: 'WebUSB is not supported in this browser. Please use Chrome or Edge.'
      }
    }

    try {
      // Request USB device with filters for common thermal printers
      this.device = await navigator.usb.requestDevice({
        filters: KNOWN_PRINTER_FILTERS
      })

      await this.device.open()

      // Find the printer interface
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1)
      }

      // Find bulk OUT endpoint for printing
      let foundInterface = false
      for (const iface of this.device.configuration!.interfaces) {
        for (const alternate of iface.alternates) {
          // Look for printer class (7) or vendor specific class
          if (alternate.interfaceClass === 7 || alternate.interfaceClass === 255) {
            for (const endpoint of alternate.endpoints) {
              if (endpoint.direction === 'out' && endpoint.type === 'bulk') {
                this.interfaceNumber = iface.interfaceNumber
                this.endpointOut = endpoint.endpointNumber
                foundInterface = true
                break
              }
            }
          }
          if (foundInterface) break
        }
        if (foundInterface) break
      }

      if (!foundInterface) {
        // Try first interface with bulk OUT endpoint
        for (const iface of this.device.configuration!.interfaces) {
          for (const alternate of iface.alternates) {
            for (const endpoint of alternate.endpoints) {
              if (endpoint.direction === 'out' && endpoint.type === 'bulk') {
                this.interfaceNumber = iface.interfaceNumber
                this.endpointOut = endpoint.endpointNumber
                foundInterface = true
                break
              }
            }
            if (foundInterface) break
          }
          if (foundInterface) break
        }
      }

      if (!foundInterface) {
        throw new Error('No suitable printing interface found on the device')
      }

      await this.device.claimInterface(this.interfaceNumber)
      this.isConnected = true

      return {
        connected: true,
        printerName: this.device.productName || 'Thermal Printer',
        error: null
      }
    } catch (error) {
      this.isConnected = false
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect to printer'
      
      // Provide user-friendly error messages
      if (errorMessage.includes('No device selected')) {
        return {
          connected: false,
          printerName: null,
          error: 'No printer selected. Please select your Deli thermal printer.'
        }
      }
      
      if (errorMessage.includes('Access denied') || errorMessage.includes('SecurityError')) {
        return {
          connected: false,
          printerName: null,
          error: 'Access denied. Please ensure the printer is not in use by another application.'
        }
      }

      return {
        connected: false,
        printerName: null,
        error: `Printer connection failed: ${errorMessage}`
      }
    }
  }

  /**
   * Disconnect from the printer
   */
  async disconnect(): Promise<void> {
    if (this.device && this.isConnected) {
      try {
        await this.device.releaseInterface(this.interfaceNumber)
        await this.device.close()
      } catch (e) {
        console.error('Error disconnecting printer:', e)
      }
    }
    this.device = null
    this.isConnected = false
  }

  /**
   * Send raw data to the printer
   */
  private async sendData(data: Uint8Array): Promise<void> {
    if (!this.device || !this.isConnected) {
      throw new Error('Printer not connected')
    }

    try {
      await this.device.transferOut(this.endpointOut, data)
    } catch (error) {
      this.isConnected = false
      throw new Error('Failed to send data to printer. Please reconnect.')
    }
  }

  /**
   * Generate ESC/POS barcode command
   * Supports: EAN13, EAN8, UPCA, CODE39, CODE128
   */
  private generateBarcodeCommand(barcode: string, barcodeType: string): Uint8Array {
    const commands: number[] = []

    // Set barcode height (in dots, 1 dot = 0.125mm at 203 DPI)
    // Height: 60 dots = ~7.5mm
    commands.push(GS, 0x68, 60)

    // Set barcode width (1-6, where 3 is medium)
    commands.push(GS, 0x77, 2)

    // Set HRI (Human Readable Interpretation) position - below barcode
    commands.push(GS, 0x48, 2)

    // Set HRI font
    commands.push(GS, 0x66, 0)

    // Print barcode based on type
    let barcodeTypeCode: number
    switch (barcodeType) {
      case 'EAN13':
        barcodeTypeCode = 67 // EAN-13
        break
      case 'EAN8':
        barcodeTypeCode = 68 // EAN-8
        break
      case 'UPCA':
        barcodeTypeCode = 65 // UPC-A
        break
      case 'CODE39':
        barcodeTypeCode = 69 // CODE39
        break
      case 'CODE128':
      default:
        barcodeTypeCode = 73 // CODE128
        break
    }

    // GS k m n d1...dn (Print barcode)
    const barcodeData = new TextEncoder().encode(barcode)
    commands.push(GS, 0x6b, barcodeTypeCode, barcodeData.length, ...barcodeData)

    return new Uint8Array(commands)
  }

  /**
   * Print barcode labels
   */
  async printLabels(data: LabelData, config: LabelConfig): Promise<{ success: boolean; error?: string }> {
    if (!this.isConnected || !this.device) {
      return { success: false, error: 'Printer not connected. Please connect first.' }
    }

    try {
      // Detect barcode type
      const barcodeType = this.detectBarcodeType(data.barcode)
      
      for (let i = 0; i < config.copies; i++) {
        const commands: number[] = []

        // Initialize printer
        commands.push(ESC, 0x40) // ESC @ - Initialize

        // Set print density (darker for thermal labels)
        commands.push(GS, 0x7c, 0x04) // Set print density

        // Center alignment
        commands.push(ESC, 0x61, 1) // ESC a 1 - Center

        // Print item name if enabled
        if (config.showName && data.itemName) {
          // Set font size (double height)
          commands.push(GS, 0x21, 0x00) // Normal size
          
          // Add item name (truncated to fit label)
          const name = data.itemName.substring(0, 24)
          const nameBytes = new TextEncoder().encode(name)
          commands.push(...nameBytes)
          commands.push(LF)
        }

        // Add small spacing
        commands.push(ESC, 0x64, 1) // Feed 1 line

        // Send name commands first
        await this.sendData(new Uint8Array(commands))

        // Generate and send barcode
        const barcodeCmd = this.generateBarcodeCommand(data.barcode, barcodeType)
        await this.sendData(barcodeCmd)

        // Print price if enabled
        if (config.showPrice && data.price !== undefined && data.price > 0) {
          const priceCommands: number[] = []
          priceCommands.push(LF)
          priceCommands.push(GS, 0x21, 0x11) // Double width and height
          const priceText = `Rs.${data.price.toFixed(2)}`
          const priceBytes = new TextEncoder().encode(priceText)
          priceCommands.push(...priceBytes)
          priceCommands.push(LF)
          await this.sendData(new Uint8Array(priceCommands))
        }

        // Feed and cut/mark end of label
        const endCommands: number[] = []
        endCommands.push(ESC, 0x64, 3) // Feed 3 lines
        
        // For label printers, use form feed to advance to next label
        endCommands.push(0x0c) // Form Feed (FF) - advance to next label
        
        await this.sendData(new Uint8Array(endCommands))

        // Small delay between labels
        if (i < config.copies - 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Print failed'
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Print labels using TSPL commands (alternative for some Deli printers)
   */
  async printLabelsTSPL(data: LabelData, config: LabelConfig): Promise<{ success: boolean; error?: string }> {
    if (!this.isConnected || !this.device) {
      return { success: false, error: 'Printer not connected. Please connect first.' }
    }

    try {
      const barcodeType = this.detectBarcodeType(data.barcode)
      
      // TSPL commands for label printing
      const commands: string[] = []

      // Set label size (in mm)
      commands.push(`SIZE ${config.width} mm, ${config.height} mm`)
      
      // Set gap between labels (typically 2-3mm)
      commands.push('GAP 2 mm, 0 mm')
      
      // Set print speed and density
      commands.push('SPEED 4')
      commands.push('DENSITY 8')
      
      // Set direction and mirror
      commands.push('DIRECTION 1,0')
      
      // Set reference point
      commands.push('REFERENCE 0,0')
      
      // Clear image buffer
      commands.push('CLS')

      // Calculate positions (in dots, 8 dots/mm at 203 DPI)
      const dotsPerMm = 8
      const labelWidthDots = config.width * dotsPerMm
      const labelHeightDots = config.height * dotsPerMm
      
      let yPos = 8 // Start position

      // Print item name if enabled
      if (config.showName && data.itemName) {
        const name = data.itemName.substring(0, 20)
        const xPos = Math.floor((labelWidthDots - name.length * 12) / 2) // Center
        commands.push(`TEXT ${Math.max(8, xPos)},${yPos},"2",0,1,1,"${name}"`)
        yPos += 24
      }

      // Print barcode
      const barcodeX = Math.floor(labelWidthDots / 2) // Center
      const barcodeHeight = Math.min(60, (labelHeightDots - yPos - 40))
      
      // Map barcode type to TSPL barcode type
      let tsplBarcodeType: string
      switch (barcodeType) {
        case 'EAN13':
          tsplBarcodeType = 'EAN13'
          break
        case 'EAN8':
          tsplBarcodeType = 'EAN8'
          break
        case 'UPCA':
          tsplBarcodeType = 'UPCA'
          break
        case 'CODE39':
          tsplBarcodeType = '39'
          break
        case 'CODE128':
        default:
          tsplBarcodeType = '128'
          break
      }

      commands.push(`BARCODE ${barcodeX - 80},${yPos},"${tsplBarcodeType}",${barcodeHeight},1,0,2,2,"${data.barcode}"`)
      yPos += barcodeHeight + 16

      // Print price if enabled
      if (config.showPrice && data.price !== undefined && data.price > 0) {
        const priceText = `Rs.${data.price.toFixed(2)}`
        const priceX = Math.floor((labelWidthDots - priceText.length * 16) / 2)
        commands.push(`TEXT ${Math.max(8, priceX)},${yPos},"3",0,1,1,"${priceText}"`)
      }

      // Print specified number of copies
      commands.push(`PRINT ${config.copies},1`)

      // Join commands and send
      const commandString = commands.join('\r\n') + '\r\n'
      const commandBytes = new TextEncoder().encode(commandString)
      
      await this.sendData(commandBytes)

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Print failed'
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Detect barcode type based on format and length
   */
  detectBarcodeType(barcode: string): string {
    // Remove any whitespace
    const clean = barcode.replace(/\s/g, '')

    // Check if all digits
    const isNumeric = /^\d+$/.test(clean)

    if (isNumeric) {
      switch (clean.length) {
        case 8:
          // EAN-8 validation (check digit)
          if (this.validateEAN(clean)) {
            return 'EAN8'
          }
          break
        case 12:
          // UPC-A validation
          if (this.validateUPCA(clean)) {
            return 'UPCA'
          }
          break
        case 13:
          // EAN-13 validation
          if (this.validateEAN(clean)) {
            return 'EAN13'
          }
          break
        case 14:
          // ITF-14 or GTIN-14 - use CODE128
          return 'CODE128'
      }
    }

    // Check for CODE39 pattern (alphanumeric with specific chars)
    if (/^[A-Z0-9\-\.\ \$\/\+\%]+$/.test(clean)) {
      return 'CODE39'
    }

    // Default to CODE128 (most versatile)
    return 'CODE128'
  }

  /**
   * Validate EAN barcode check digit
   */
  private validateEAN(barcode: string): boolean {
    const digits = barcode.split('').map(Number)
    const checkDigit = digits.pop()!
    
    let sum = 0
    const isEAN13 = digits.length === 12
    
    digits.forEach((digit, index) => {
      if (isEAN13) {
        sum += digit * (index % 2 === 0 ? 1 : 3)
      } else {
        sum += digit * (index % 2 === 0 ? 3 : 1)
      }
    })
    
    const calculatedCheck = (10 - (sum % 10)) % 10
    return calculatedCheck === checkDigit
  }

  /**
   * Validate UPC-A check digit
   */
  private validateUPCA(barcode: string): boolean {
    const digits = barcode.split('').map(Number)
    const checkDigit = digits.pop()!
    
    let sum = 0
    digits.forEach((digit, index) => {
      sum += digit * (index % 2 === 0 ? 3 : 1)
    })
    
    const calculatedCheck = (10 - (sum % 10)) % 10
    return calculatedCheck === checkDigit
  }

  /**
   * Test print - prints a test label
   */
  async testPrint(): Promise<{ success: boolean; error?: string }> {
    return this.printLabels(
      {
        barcode: '1234567890123',
        itemName: 'Test Item',
        price: 99.99
      },
      {
        width: 50,
        height: 30,
        copies: 1,
        showName: true,
        showPrice: true
      }
    )
  }
}

// Export singleton instance
export const thermalPrinter = new ThermalPrinterService()
export default thermalPrinter
