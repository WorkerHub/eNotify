/**
 * Lunar calendar utilities for years 1900–2100.
 *
 * Encoding of lunarInfo[i] (i = year − 1900):
 *   bits 16..5  – whether each of the 12 regular months has 30 days (1) or 29 days (0)
 *   bit  16     – whether the leap month (if any) has 30 days
 *   bits  3..0  – which month is the leap month (0 = none)
 */

// ─── Lookup table (1900–2100, 201 entries) ────────────────────────────────────

const lunarInfo: readonly number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0,
  0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540,
  0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50,
  0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0,
  0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2,
  0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573,
  0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60, 0x0aae4,
  0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5,
  0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46,
  0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58,
  0x055c0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50,
  0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
  0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260,
  0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0,
  0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2, 0x049b0,
  0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370,
  0x14a38, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x1a978, 0x16aa0, 0x0a6c0,
  0x0aa60, 0x16d63, 0x0d260, 0x0d950, 0x0d554, 0x0d4a0, 0x0da50, 0x07552,
  0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0, 0x0baa4,
  0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, 0x07954,
  0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65,
  0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x1a4bb, 0x0a4d0, 0x0d0b0,
  0x0d250,
];

// ─── String tables ────────────────────────────────────────────────────────────

const MONTHS = [
  "正",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "冬",
  "腊",
] as const;

const DAYS = [
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
] as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function leapMonth(year: number): number {
  return lunarInfo[year - 1900] & 0xf;
}

function leapDays(year: number): number {
  return leapMonth(year) ? (lunarInfo[year - 1900] & 0x10000 ? 30 : 29) : 0;
}

function monthDays(year: number, month: number): number {
  return lunarInfo[year - 1900] & (0x10000 >> month) ? 30 : 29;
}

function lunarYearDays(year: number): number {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += lunarInfo[year - 1900] & i ? 1 : 0;
  }
  return sum + leapDays(year);
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  isLeap: boolean;
  monthStr: string;
  dayStr: string;
}

export interface SolarDate {
  year: number;
  month: number;
  day: number;
}

// ─── Core conversions ─────────────────────────────────────────────────────────

/**
 * Convert a Gregorian date to its Chinese lunar equivalent.
 * Returns null when the date is outside the 1900–2100 range.
 */
export function solarToLunar(
  year: number,
  month: number,
  day: number,
): LunarDate | null {
  if (year < 1900 || year > 2100) return null;

  // Days elapsed since the lunar epoch: 1900-01-31
  const baseMs = Date.UTC(1900, 0, 31);
  const dateMs = Date.UTC(year, month - 1, day);
  let offset = Math.round((dateMs - baseMs) / 86_400_000);

  let temp = 0;
  let lunarYear = 1900;
  for (; lunarYear < 2101 && offset > 0; lunarYear++) {
    temp = lunarYearDays(lunarYear);
    offset -= temp;
  }
  if (offset < 0) {
    offset += temp;
    lunarYear--;
  }

  let lunarMonth = 1;
  const leap = leapMonth(lunarYear);
  let isLeap = false;

  for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
    if (leap > 0 && lunarMonth === leap + 1 && !isLeap) {
      --lunarMonth;
      isLeap = true;
      temp = leapDays(lunarYear);
    } else {
      temp = monthDays(lunarYear, lunarMonth);
    }
    if (isLeap && lunarMonth === leap + 1) isLeap = false;
    offset -= temp;
  }

  if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
    if (isLeap) {
      isLeap = false;
    } else {
      isLeap = true;
      --lunarMonth;
    }
  }

  if (offset < 0) {
    offset += temp;
    --lunarMonth;
  }

  const lunarDay = offset + 1;

  return {
    year: lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeap,
    monthStr: (isLeap ? "闰" : "") + MONTHS[lunarMonth - 1] + "月",
    dayStr: DAYS[lunarDay - 1],
  };
}

/**
 * Convert a Chinese lunar date back to its Gregorian equivalent.
 * Searches solar dates in the range [lunarYear−1, lunarYear+1].
 * Returns null if no matching solar date is found.
 */
export function lunarToSolar(
  year: number,
  month: number,
  day: number,
  isLeap: boolean,
): SolarDate | null {
  for (let y = year - 1; y <= year + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        // Skip days that don't exist in this month (e.g. Feb 30)
        const probe = new Date(y, m - 1, d);
        if (
          probe.getFullYear() !== y ||
          probe.getMonth() + 1 !== m ||
          probe.getDate() !== d
        )
          continue;

        const lunar = solarToLunar(y, m, d);
        if (
          lunar &&
          lunar.year === year &&
          lunar.month === month &&
          lunar.day === day &&
          lunar.isLeap === isLeap
        ) {
          return { year: y, month: m, day: d };
        }
      }
    }
  }
  return null;
}

/**
 * Add `years` lunar years to a solar date (YYYY-MM-DD) and return the
 * resulting solar date as a YYYY-MM-DD string.
 *
 * Preserves the same lunar month and day in the target year.  When the target
 * lunar month has fewer days than the original lunar day, the day is clamped
 * to the last day of the target month.
 */
export function addLunarYears(solarDate: string, years: number): string {
  const [y, m, d] = solarDate.split("-").map(Number);
  const lunar = solarToLunar(y, m, d);
  if (!lunar) return solarDate;

  let { year: lYear, month: lMonth, day: lDay, isLeap: lIsLeap } = lunar;
  lYear += years;

  // Preserve leap flag only if the target year has a leap month at the same position
  lIsLeap = lIsLeap && leapMonth(lYear) === lMonth;

  const maxDay = lIsLeap ? leapDays(lYear) : monthDays(lYear, lMonth);
  const targetDay = Math.min(lDay, maxDay);

  for (let dd = targetDay; dd >= 1; dd--) {
    const solar = lunarToSolar(lYear, lMonth, dd, lIsLeap);
    if (solar) return isoDate(solar.year, solar.month, solar.day);
  }

  return solarDate;
}

/**
 * Add `months` lunar months to a solar date (YYYY-MM-DD) and return the
 * resulting solar date as a YYYY-MM-DD string.
 *
 * The month arithmetic is calendar-month arithmetic on the lunar calendar
 * (leap months are not counted separately).  When the target lunar month has
 * fewer days than the original lunar day, the day is clamped to the last day
 * of the target month.
 */
export function addLunarMonths(solarDate: string, months: number): string {
  const [y, m, d] = solarDate.split("-").map(Number);
  const lunar = solarToLunar(y, m, d);
  if (!lunar) return solarDate;

  let { year: lYear, month: lMonth, day: lDay, isLeap: lIsLeap } = lunar;

  // Simple lunar-month arithmetic (does not count leap months as extra months)
  const totalMonths = (lYear - 1900) * 12 + (lMonth - 1) + months;
  lYear = Math.floor(totalMonths / 12) + 1900;
  lMonth = (totalMonths % 12) + 1;

  // Only preserve the leap flag if the target year still has a leap month
  // at the same position
  lIsLeap = lIsLeap && leapMonth(lYear) === lMonth;

  // Clamp the day to the actual length of the target month
  const maxDay = lIsLeap ? leapDays(lYear) : monthDays(lYear, lMonth);
  const targetDay = Math.min(lDay, maxDay);

  // Try to find a solar date, walking the day back if necessary
  for (let dd = targetDay; dd >= 1; dd--) {
    const solar = lunarToSolar(lYear, lMonth, dd, lIsLeap);
    if (solar) {
      return isoDate(solar.year, solar.month, solar.day);
    }
  }

  return solarDate; // unreachable for valid in-range dates
}

// ─── Formatting helper ────────────────────────────────────────────────────────

function isoDate(year: number, month: number, day: number): string {
  return [
    year.toString().padStart(4, "0"),
    month.toString().padStart(2, "0"),
    day.toString().padStart(2, "0"),
  ].join("-");
}
