// Type declarations for i2c-bus (native module, only available on Pi)
// This allows TypeScript to compile even when the module isn't installed locally

declare module 'i2c-bus' {
  export interface I2CBus {
    i2cReadSync(addr: number, length: number, buffer: Buffer): number
    i2cWriteSync(addr: number, length: number, buffer: Buffer): number
    closeSync(): void
    close(callback: (err: Error | null) => void): void
  }

  export function openSync(busNumber: number, options?: { forceAccess?: boolean }): I2CBus
  export function open(busNumber: number, callback: (err: Error | null, bus: I2CBus) => void): void
  export function open(busNumber: number, options: { forceAccess?: boolean }, callback: (err: Error | null, bus: I2CBus) => void): void
}
