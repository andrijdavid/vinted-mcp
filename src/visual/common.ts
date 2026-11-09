import { getCountry } from "../vinted-core/models/country";

/** Bounded TTL cache. Failed loads are never cached. */
export class TTLCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private ttlMs = 120_000, private capacity = 128) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key: string, value: T): T {
    this.entries.delete(key);
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }
  clear(): void { this.entries.clear(); }
}

export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Expected integer ${min}..${max}`);
  return Number(value);
}
export function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function countryCode(value: unknown = "fr"): string {
  if (typeof value !== "string") throw new Error("country must be a country code");
  return getCountry(value).code;
}
export const fold = (value: unknown): string => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function textValue(value: any): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") return textValue(value.title ?? value.name ?? value.value);
  return null;
}
export function boundedText(value: unknown, name: string, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > 300 || (required && !value.trim())) throw new Error(`${name} must be text (1..300 characters)`);
  return value.trim();
}
export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 100) / 100;
