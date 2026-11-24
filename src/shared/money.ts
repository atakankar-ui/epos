// All sums on the till are done in whole pence, never in pounds with decimals,
// so 0.1 + 0.2 style rounding slips cannot happen.

// The database holds pounds (1.49). Turn that into pence (149).
export function poundsToPence(pounds: number | string | null | undefined): number | null {
  if (pounds === null || pounds === undefined || pounds === '') return null
  const value = typeof pounds === 'string' ? Number(pounds) : pounds
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

export function formatPence(pence: number): string {
  const sign = pence < 0 ? '-' : ''
  const abs = Math.abs(pence)
  const pounds = Math.floor(abs / 100).toLocaleString('en-GB')
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, '0')}`
}

// Keys typed on the keypad are pence: "149" means £1.49, "5" means £0.05.
export function keyedPence(digits: string): number | null {
  if (!/^\d{1,7}$/.test(digits)) return null
  return Number(digits)
}

// 0.2 -> "20%", 0.05 -> "5%", 0 -> "0%"
export function formatRate(rate: number): string {
  return `${Math.round(rate * 10000) / 100}%`
}
