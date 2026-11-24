// The bridge: the only things the screen is allowed to ask the Windows program for.
import { contextBridge, ipcRenderer } from 'electron'
import type { LocalApi } from '../shared/local'
import type { HardwareApi } from '../shared/hardware'

const local: LocalApi = {
  getState: () => ipcRenderer.invoke('local:getState'),
  bind: (binding) => ipcRenderer.invoke('local:bind', binding),
  unbind: () => ipcRenderer.invoke('local:unbind'),
  getProducts: () => ipcRenderer.invoke('local:getProducts'),
  replaceProducts: (products) => ipcRenderer.invoke('local:replaceProducts', products),
  saveSale: (draft) => ipcRenderer.invoke('local:saveSale', draft),
  pendingSales: (limit) => ipcRenderer.invoke('local:pendingSales', limit),
  markSynced: (id) => ipcRenderer.invoke('local:markSynced', id),
  markRefused: (id, reason) => ipcRenderer.invoke('local:markRefused', id, reason),
}

const hardware: HardwareApi = {
  getConfig: () => ipcRenderer.invoke('hardware:getConfig'),
  setConfig: (config) => ipcRenderer.invoke('hardware:setConfig', config),
  listPrinters: () => ipcRenderer.invoke('hardware:listPrinters'),
  afterSale: (saleId) => ipcRenderer.invoke('hardware:afterSale', saleId),
  printReceipt: (saleId, copy) => ipcRenderer.invoke('hardware:printReceipt', saleId, copy),
  receiptText: (saleId) => ipcRenderer.invoke('hardware:receiptText', saleId),
  testPrint: () => ipcRenderer.invoke('hardware:testPrint'),
  testDrawer: () => ipcRenderer.invoke('hardware:testDrawer'),
  setShopDetails: (details) => ipcRenderer.invoke('hardware:setShopDetails', details),
  getShopDetails: () => ipcRenderer.invoke('hardware:getShopDetails'),
}

const till = {
  appInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('app:info'),
  local,
  hardware,
}

contextBridge.exposeInMainWorld('till', till)

export type TillBridge = typeof till
