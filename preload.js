const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coffeeApi', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  session: () => ipcRenderer.invoke('auth:session'),
  list: (entity, params) => ipcRenderer.invoke('data:list', entity, params),
  create: (entity, payload) => ipcRenderer.invoke('data:create', entity, payload),
  update: (entity, id, payload) => ipcRenderer.invoke('data:update', entity, id, payload),
  remove: (entity, id) => ipcRenderer.invoke('data:delete', entity, id),
  dashboard: () => ipcRenderer.invoke('reports:dashboard'),
  productCost: (productId) => ipcRenderer.invoke('reports:productCost', productId),
  backup: () => ipcRenderer.invoke('system:backup'),
  exportExcel: (entity) => ipcRenderer.invoke('system:exportExcel', entity)
});
