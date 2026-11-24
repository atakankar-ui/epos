// The bridge: the only things the screen is allowed to ask the Windows program for.
import { contextBridge, ipcRenderer } from 'electron'

const till = {
  appInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('app:info'),
}

contextBridge.exposeInMainWorld('till', till)

export type TillBridge = typeof till
