import { fold } from "./common";

export function sellerRisk(seller: any): { level: string; flags: string[]; recommendation: string } {
  const flags: string[] = [];
  const rating = seller?.rating;
  const count = seller?.ratingCount;
  if (rating == null || !count) flags.push("Seller reputation is unavailable or has no reviews; this is not proof of fraud");
  if (typeof rating === "number" && rating < 3.5 && count >= 5) flags.push("Low average rating across at least five reviews");
  if (typeof count === "number" && count > 0 && count < 5) flags.push("Limited review history; this is not proof of fraud");
  const high = rating != null && rating < 3.5 && count >= 5;
  return { level: high ? "high" : flags.length ? "unknown" : "low", flags,
    recommendation: high ? "do_not_recommend" : flags.length ? "review_required" : "eligible_with_listing_checks" };
}
export function listingRisk(item: any, peers: any[] = []): any {
  const seller = sellerRisk(item.seller);
  const flags = [...seller.flags];
  const t = fold(`${item.title} ${item.description}`);
  if (item.isSold || item.availability === "sold") flags.push("Listing is sold");
  if (item.reserved) flags.push("Listing cannot currently be purchased or is reserved");
  if (item.availability === "unknown" || !item.availability) flags.push("Availability has not been verified");
  if (!item.photos?.length) flags.push("Missing listing photos");
  if (!item.size && !item.sizeOptional) flags.push("Missing size information");
  if (item.price == null || !item.currency) flags.push("Missing price or currency");
  if (!item.condition) flags.push("Condition is unknown");
  if (/\b(gat|gaatje|hole|trou|scheur|torn|kapot|damaged|beschadigd|vlek|stain|tache)\b/.test(t)) flags.push("Possible damage mentioned; inspect description and photos (may include negated statements)");
  if (/\b(replica|fake|namaak|imitatie|counterfeit|authenticity unknown)\b/.test(t)) flags.push("Authenticity concern mentioned in listing");
  if (/new|nieuw|neuf/.test(fold(item.condition)) && /\b(worn|gedragen|porte|used)\b/.test(fold(item.description))) flags.push("Possible condition inconsistency; inspect seller wording");
  const duplicate = peers.some(p => p.id !== item.id && p.photos?.some((url: string) => item.photos?.includes(url)));
  if (duplicate) flags.push("Photo reused by another listing; duplicate or legitimate relisting needs review");
  const prices = peers.filter(p => p.id !== item.id && p.currency === item.currency && p.categoryId === item.categoryId && p.price > 0).map(p => p.price).sort((a, b) => a - b);
  if (prices.length >= 5 && item.price > 0 && item.price < prices[Math.floor(prices.length / 2)] * 0.25) flags.push("Price far below sampled comparable listings; low price alone does not establish fraud");
  const excluded = item.isSold || item.reserved || seller.level === "high" || /\b(replica|fake|namaak|counterfeit)\b/.test(t);
  return { level: excluded ? "high" : flags.length ? "review_required" : "low", flags,
    recommendation: excluded ? "do_not_recommend" : flags.length ? "review_required" : "eligible",
    note: "Heuristic quality flags, not authentication or a fraud determination. Seller claims and review history may be incomplete." };
}
