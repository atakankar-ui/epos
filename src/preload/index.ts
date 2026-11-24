// The bridge: the only things the screen is allowed to ask the Windows program for.
import { contextBridge, ipcRenderer } from 'electron'
import type { LocalApi } from '../shared/local'

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

const till = {
  appInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('app:info'),
  local,
}

contextBridge.exposeInMainWorld('till', till)

export type TillBridge = typeof till
