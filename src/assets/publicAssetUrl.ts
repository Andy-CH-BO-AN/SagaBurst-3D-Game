/** Public assets share Vite's base in development, Pages and Electron. */
export function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
