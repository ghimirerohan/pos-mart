/** Bikram Sambat date parts (used with NepaliDatePicker value strings YYYY-MM-DD). */
export interface BSDate {
  year: number;
  month: number;
  day: number;
}

export const BS_YEAR_START = 2075;
export const BS_YEAR_END = 2095;

const BS_DEFAULTS_API = "/api/method/klik_pos.api.date_wise_inventory.get_bs_defaults";
const BS_RANGE_API = "/api/method/klik_pos.api.date_wise_inventory.bs_range_to_ad";
const AD_TO_BS_BATCH_API = "/api/method/klik_pos.api.date_wise_inventory.ad_to_bs_batch";

export function bsDateToStr(d: BSDate): string {
  const y = d.year;
  const m = String(d.month).padStart(2, "0");
  const day = String(d.day).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseBsDateStr(s: string): BSDate | null {
  if (!s || typeof s !== "string") return null;
  const parts = s.trim().split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return { year, month, day };
}

export async function fetchBsDefaults(): Promise<{
  fromBs: BSDate;
  toBs: BSDate;
  fromDateAd: string;
  toDateAd: string;
}> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const adWeekFallback = () => {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    return {
      fromDateAd: `${weekAgo.getFullYear()}-${pad(weekAgo.getMonth() + 1)}-${pad(weekAgo.getDate())}`,
      toDateAd: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    };
  };

  try {
    const res = await fetch(BS_DEFAULTS_API, { credentials: "include" });
    const json = await res.json();
    const d = json.message?.data;
    if (d?.from_date_bs?.year != null && d?.to_date_bs?.year != null && d.from_date_ad && d.to_date_ad) {
      return {
        fromBs: {
          year: d.from_date_bs.year,
          month: d.from_date_bs.month,
          day: d.from_date_bs.day,
        },
        toBs: {
          year: d.to_date_bs.year,
          month: d.to_date_bs.month,
          day: d.to_date_bs.day,
        },
        fromDateAd: String(d.from_date_ad).slice(0, 10),
        toDateAd: String(d.to_date_ad).slice(0, 10),
      };
    }
    const { fromDateAd, toDateAd } = d?.from_date_ad && d?.to_date_ad
      ? { fromDateAd: String(d.from_date_ad).slice(0, 10), toDateAd: String(d.to_date_ad).slice(0, 10) }
      : adWeekFallback();
    const map = await fetchAdToBsMap([fromDateAd, toDateAd]);
    const fromParsed = parseBsDateStr(map[fromDateAd] || "");
    const toParsed = parseBsDateStr(map[toDateAd] || "");
    return {
      fromBs: fromParsed || { year: 2081, month: 1, day: 1 },
      toBs: toParsed || { year: 2081, month: 1, day: 1 },
      fromDateAd,
      toDateAd,
    };
  } catch {
    const { fromDateAd, toDateAd } = adWeekFallback();
    const map = await fetchAdToBsMap([fromDateAd, toDateAd]).catch(() => ({}));
    const fromParsed = parseBsDateStr(map[fromDateAd] || "");
    const toParsed = parseBsDateStr(map[toDateAd] || "");
    return {
      fromBs: fromParsed || { year: 2081, month: 1, day: 1 },
      toBs: toParsed || { year: 2081, month: 1, day: 1 },
      fromDateAd,
      toDateAd,
    };
  }
}

export async function fetchBsRangeToAd(
  fromBs: BSDate,
  toBs: BSDate
): Promise<{ from_date_ad: string; to_date_ad: string }> {
  const params = new URLSearchParams({
    from_year: String(fromBs.year),
    from_month: String(fromBs.month),
    from_day: String(fromBs.day),
    to_year: String(toBs.year),
    to_month: String(toBs.month),
    to_day: String(toBs.day),
  });
  const res = await fetch(`${BS_RANGE_API}?${params}`, { credentials: "include" });
  const json = await res.json();
  const msg = json.message;
  if (msg?.from_date_ad && msg?.to_date_ad) {
    return {
      from_date_ad: String(msg.from_date_ad).slice(0, 10),
      to_date_ad: String(msg.to_date_ad).slice(0, 10),
    };
  }
  throw new Error(json.exc || json.message?.error || "Invalid BS date range");
}

export async function fetchAdToBsMap(adDates: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(adDates.map((d) => d?.slice(0, 10)).filter(Boolean))] as string[];
  if (unique.length === 0) return {};
  const params = new URLSearchParams({ ad_dates: unique.join(",") });
  const res = await fetch(`${AD_TO_BS_BATCH_API}?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  const json = await res.json();
  const m = json.message?.map;
  if (m && typeof m === "object") return m as Record<string, string>;
  return {};
}

/** Clock display using Nepal locale (Nepali numerals where supported). */
export function formatNepaliTime(postingTime: string): string {
  if (!postingTime) return "";
  const parts = postingTime.split(":");
  const hour = parseInt(parts[0] ?? "0", 10);
  const minute = parts[1] ?? "00";
  if (Number.isNaN(hour)) return postingTime;
  const d = new Date(2000, 0, 1, hour, parseInt(minute, 10) || 0);
  try {
    return d.toLocaleTimeString("ne-NP", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${ampm}`;
  }
}
