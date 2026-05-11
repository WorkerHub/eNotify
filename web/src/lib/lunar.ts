/**
 * Lunar calendar utilities (1900–2100).
 * Frontend mirror of worker/src/core/lunar.ts.
 */

const lunarInfo: readonly number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x14a38, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x1a978, 0x16aa0, 0x0a6c0,
  0x0aa60, 0x16d63, 0x0d260, 0x0d950, 0x0d554, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7,
  0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0,
  0x15176, 0x052b0, 0x0a930, 0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0,
  0x0d260, 0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x1a4bb, 0x0a4d0, 0x0d0b0,
  0x0d250,
]

const HEAVENLY = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
const EARTHLY = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const

function lunarYearName(year: number): string {
  const h = (year - 4) % 10
  const e = (year - 4) % 12
  return HEAVENLY[h < 0 ? h + 10 : h] + EARTHLY[e < 0 ? e + 12 : e]
}

const MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'] as const
const DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
] as const

function leapMonth(year: number): number { return lunarInfo[year - 1900] & 0xf }
function leapDays(year: number): number { return leapMonth(year) ? ((lunarInfo[year - 1900] & 0x10000) ? 30 : 29) : 0 }
function monthDays(year: number, month: number): number { return (lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29 }
function lunarYearDays(year: number): number {
  let sum = 348
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[year - 1900] & i) ? 1 : 0
  return sum + leapDays(year)
}

export interface LunarDate {
  lunarYear: number
  month: number
  day: number
  isLeap: boolean
  monthStr: string
  dayStr: string
}

export function solarToLunar(year: number, month: number, day: number): LunarDate | null {
  if (year < 1900 || year > 2100) return null
  const baseMs = Date.UTC(1900, 0, 31)
  const dateMs = Date.UTC(year, month - 1, day)
  let offset = Math.round((dateMs - baseMs) / 86_400_000)

  let temp = 0
  let lunarYear = 1900
  for (; lunarYear < 2101 && offset > 0; lunarYear++) { temp = lunarYearDays(lunarYear); offset -= temp }
  if (offset < 0) { offset += temp; lunarYear-- }

  let lunarMonth = 1
  const leap = leapMonth(lunarYear)
  let isLeap = false
  for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
    if (leap > 0 && lunarMonth === leap + 1 && !isLeap) { --lunarMonth; isLeap = true; temp = leapDays(lunarYear) }
    else { temp = monthDays(lunarYear, lunarMonth) }
    if (isLeap && lunarMonth === leap + 1) isLeap = false
    offset -= temp
  }
  if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
    if (isLeap) { isLeap = false } else { isLeap = true; --lunarMonth }
  }
  if (offset < 0) { offset += temp; --lunarMonth }

  const lunarDay = offset + 1

  return {
    lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeap,
    monthStr: (isLeap ? '闰' : '') + MONTHS[lunarMonth - 1] + '月',
    dayStr: DAYS[lunarDay - 1],
  }
}

/**
 * Convert a Chinese lunar date back to its Gregorian equivalent.
 * Searches solar dates in the range [lunarYear−1, lunarYear+1].
 */
export function lunarToSolar(
  year: number,
  month: number,
  day: number,
  isLeap: boolean,
): { year: number; month: number; day: number } | null {
  for (let y = year - 1; y <= year + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const probe = new Date(y, m - 1, d)
        if (
          probe.getFullYear() !== y ||
          probe.getMonth() + 1 !== m ||
          probe.getDate() !== d
        ) continue

        const lunar = solarToLunar(y, m, d)
        if (
          lunar &&
          lunar.lunarYear === year &&
          lunar.month === month &&
          lunar.day === day &&
          lunar.isLeap === isLeap
        ) {
          return { year: y, month: m, day: d }
        }
      }
    }
  }
  return null
}

/**
 * Convert a YYYY-MM-DD solar date string to a display string like "丙午年二月初十".
 * Returns null if the date is invalid or out of range.
 */
export function formatLunarDate(solarDateStr: string): string | null {
  if (!solarDateStr) return null
  const parts = solarDateStr.split('-').map(Number)
  if (parts.length !== 3) return null
  const [y, m, d] = parts
  const lunar = solarToLunar(y, m, d)
  if (!lunar) return null
  return `${lunarYearName(lunar.lunarYear)}年${lunar.monthStr}${lunar.dayStr}`
}

/**
 * Given a solar date (YYYY-MM-DD), compute the next lunar anniversary's solar date.
 * Returns the solar date as YYYY-MM-DD, or null if out of range.
 */
export function nextLunarAnniversary(solarDateStr: string): string | null {
  const [y, m, d] = solarDateStr.split('-').map(Number)
  const lunar = solarToLunar(y, m, d)
  if (!lunar) return null

  const now = new Date()
  const currentYear = now.getFullYear()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Try this year
  const thisYear = lunarToSolar(currentYear, lunar.month, lunar.day, lunar.isLeap)
  if (thisYear) {
    const dateStr = `${thisYear.year.toString().padStart(4, '0')}-${thisYear.month.toString().padStart(2, '0')}-${thisYear.day.toString().padStart(2, '0')}`
    if (dateStr > todayStr) return dateStr
  }

  // Try next year
  const nextYear = lunarToSolar(currentYear + 1, lunar.month, lunar.day, lunar.isLeap)
  if (nextYear) {
    return `${nextYear.year.toString().padStart(4, '0')}-${nextYear.month.toString().padStart(2, '0')}-${nextYear.day.toString().padStart(2, '0')}`
  }

  return null
}
