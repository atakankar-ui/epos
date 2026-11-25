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
  getStaff: () => ipcRenderer.invoke('local:getStaff'),
  setStaff: (staff) => ipcRenderer.invoke('local:setStaff', staff),
  logAudit: (row) => ipcRenderer.invoke('local:logAudit', row),
  saveRefund: (draft) => ipcRenderer.invoke('local:saveRefund', draft),
  findSale: (receiptNo) => ipcRenderer.invoke('local:findSale', receiptNo),
  recentSales: (limit) => ipcRenderer.invoke('local:recentSales', limit),
  refundedHere: (saleId, onlyUnsent) => ipcRenderer.invoke('local:refundedHere', saleId, onlyUnsent),
  pendingOther: (limit, onlyDayOpens) => ipcRenderer.invoke('local:pendingOther', limit, onlyDayOpens),
  currentDay: () => ipcRenderer.invoke('local:currentDay'),
  openDay: (input) => ipcRenderer.invoke('local:openDay', input),
  closeDay: (input) => ipcRenderer.invoke('local:closeDay', input),
  dayData: (dayId) => ipcRenderer.invoke('local:dayData', dayId),
  listDays: (limit) => ipcRenderer.invoke('local:listDays', limit),
  topProductIds: (limit) => ipcRenderer.invoke('local:topProductIds', limit),
  markOtherSynced: (id) => ipcRenderer.invoke('local:markOtherSynced', id),
  markOtherRefused: (id, reason) => ipcRenderer.invoke('local:markOtherRefused', id, reason),
}

const hardware: HardwareApi = {
  getConfig: () => ipcRenderer.invoke('hardware:getConfig'),
  setConfig: (config) => ipcRenderer.invoke('hardware:setConfig', config),
  listPrinters: () => ipcRenderer.invoke('hardware:listPrinters'),
  afterSale: (saleId) => ipcRenderer.invoke('hardware:afterSale', saleId),
  printReceipt: (saleId, copy) => ipcRenderer.invoke('hardware:printReceipt', saleId, copy),
  receiptText: (saleId) => ipcRenderer.invoke('hardware:receiptText', saleId),
  testPrint: () => ipcRenderer.invoke('hardware:testPrint'),
  printLines: (lines) => ipcRenderer.invoke('hardware:printLines', lines),
  testDrawer: () => ipcRenderer.invoke('hardware:testDrawer'),
  openDrawer: () => ipcRenderer.invoke('hardware:testDrawer'),
  afterRefund: (refundId) => ipcRenderer.invoke('hardware:afterRefund', refundId),
  printRefund: (refundId) => ipcRenderer.invoke('hardware:printRefund', refundId),
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
