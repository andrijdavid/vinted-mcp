import { roundMoney } from "./common";

export interface CostEstimates { shippingPerSeller?: number; buyerProtectionFixedPerItem?: number; buyerProtectionPercent?: number; bundleDiscountPercent?: number; }
export function validateCosts(costs: CostEstimates = {}): void {
  for (const [key, value] of Object.entries(costs)) {
    if (!["shippingPerSeller", "buyerProtectionFixedPerItem", "buyerProtectionPercent", "bundleDiscountPercent"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > (key.endsWith("Percent") ? 100 : 1000)) throw new Error("Invalid cost estimate");
  }
}
export function outfitCost(items: any[], currency: string, costs: CostEstimates = {}): any {
  validateCosts(costs);
  if (items.some(i => typeof i.price !== "number" || !Number.isFinite(i.price) || i.price < 0 || i.currency !== currency)) return null;
  const subtotal = roundMoney(items.reduce((s, i) => s + i.price, 0));
  const sellers = new Map<string, any[]>();
  for (const item of items) {
    const key = item.seller?.id ? `${item.country}:${item.seller.id}` : `unknown:${item.country}:${item.id}`;
    sellers.set(key, [...(sellers.get(key) || []), item]);
  }
  const bundleEligibleSubtotal = [...sellers.values()].filter(v => v.length >= 2).reduce((s, v) => s + v.reduce((t, i) => t + i.price, 0), 0);
  const discount = costs.bundleDiscountPercent === undefined ? null : roundMoney(bundleEligibleSubtotal * costs.bundleDiscountPercent / 100);
  const shipping = costs.shippingPerSeller === undefined ? null : roundMoney(sellers.size * costs.shippingPerSeller);
  const protectionKnownPart = roundMoney(items.length * (costs.buyerProtectionFixedPerItem || 0) + (subtotal - (discount || 0)) * (costs.buyerProtectionPercent || 0) / 100);
  const protection = costs.buyerProtectionFixedPerItem === undefined || costs.buyerProtectionPercent === undefined ? null : protectionKnownPart;
  const total = shipping === null || protection === null ? null : roundMoney(subtotal - (discount || 0) + shipping + protection);
  return { currency, listingSubtotal: subtotal,
    shipping: { amount: shipping, kind: shipping === null ? "unknown" : "caller_estimate", sellerShipments: sellers.size },
    buyerProtection: { amount: protection, kind: protection === null ? "unknown" : "caller_estimate", knownOrEstimatedPart: protectionKnownPart },
    bundleDiscount: { amount: discount, kind: discount === null ? "not_assumed" : "caller_estimate_unconfirmed" },
    total: { amount: total, kind: total === null ? "unknown" : "estimate_not_checkout_quote" },
    knownCostLowerBound: roundMoney(subtotal - (discount || 0) + (shipping || 0) + protectionKnownPart),
    warning: "Shipping, fees and bundle discounts depend on checkout and seller settings. Grouping same-seller items assumes a bundle is possible. Estimates are not a guaranteed final price." };
}
/** Bounded beam search: considers all candidates at each stage and retains 500 best partial outfits. */
export function optimizeOutfit(parts: { id: string; candidates: any[] }[], budget: number, currency: string, costs: CostEstimates = {}): any {
  validateCosts(costs);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("budget must be non-negative");
  let states: any[] = [{ items: [], value: 0 }];
  for (const part of parts) {
    const next: any[] = [];
    for (const state of states) for (const candidate of part.candidates.slice(0, 12)) {
      if (candidate.risk?.recommendation === "do_not_recommend" || candidate.isSold || candidate.reserved ||
          candidate.visualMatch?.criteria?.some(c => ["color", "fit", "neckline", "shoeModel", "silhouette"].includes(c.feature) && c.status === "mismatch") ||
          candidate.sizeStatus === "mismatch" || candidate.sizeStatus === "unknown" || candidate.price == null ||
          state.items.some(i => i.id === candidate.id && i.country === candidate.country)) continue;
      const items = [...state.items, { ...candidate, componentId: part.id }];
      const price = outfitCost(items, currency, costs);
      if (!price) continue;
      // Do not prune partial states by price: later same-seller bundles can reduce estimates.
      const visual = candidate.visualMatch?.score;
      const value = state.value + (visual == null ? (candidate.metadataMatch?.score || 0) * 0.4 : visual) - (candidate.risk?.level === "low" ? 0 : 10);
      next.push({ items, value, cost: price });
    }
    next.sort((a, b) => b.value - a.value || a.cost.knownCostLowerBound - b.cost.knownCostLowerBound);
    // Reserve space for cheap combinations so expensive visual leaders cannot crowd out all budget fits.
    const cheap = [...next].sort((a, b) => a.cost.knownCostLowerBound - b.cost.knownCostLowerBound || b.value - a.value).slice(0, 150);
    const keys = new Set<string>();
    states = [...next.slice(0, 350), ...cheap].filter(s => { const key = s.items.map(i => i.id).join(":"); if (keys.has(key)) return false; keys.add(key); return true; });
    if (!states.length) break;
  }
  const complete = states.filter(s => s.items.length === parts.length && s.cost.knownCostLowerBound <= budget + 0.001);
  complete.sort((a, b) => b.value - a.value || a.cost.knownCostLowerBound - b.cost.knownCostLowerBound);
  return { combinations: complete.slice(0, 3).map(({ items, cost }) => ({
    items, cost, budgetStatus: cost.total.amount === null ? "listing_and_known_costs_only_final_total_unknown" : "estimated_within_budget",
    recommendation: items.every(i => i.risk?.level === "low" && i.availability === "available" && i.visualMatch?.score >= 70 && i.visualMatch?.coverage >= 70 && !i.visualMatch?.criteria?.some(c => c.status === "mismatch")) ? "reviewed_candidate_outfit_checkout_required" : "provisional_requires_visual_size_availability_or_seller_review"
  })), optimizer: "bounded_beam_500_states_not_guaranteed_global_optimum",
    status: complete.length ? "complete_provisional_combinations" : "no_complete_eligible_combination_within_known_budget",
    budget, currency, unknownCostsPreventBudgetGuarantee: complete.some(s => s.cost.total.amount === null) };
}
