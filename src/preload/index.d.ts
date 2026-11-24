import type { TillBridge } from './index'

declare global {
  interface Window {
    till: TillBridge
  }
}
export {}
