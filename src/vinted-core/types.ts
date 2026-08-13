export interface AuthSession {
  accessToken: string;
  cookies: Record<string, string>;
  csrfToken: string;
  country: string;
  expiresAt: number;
  userId?: number;
  username?: string;
}

export type AuthMode = "http" | "playwright" | "env";

export interface ClientOptions {
  authMode?: AuthMode;
  maxConcurrency?: number;
  requestDelayMs?: number;
  jitterMs?: number;
  maxRetries?: number;
  proxyUrl?: string;
  proxies?: string[];
}

export interface SearchParams {
  query?: string;
  country: string;
  categoryId?: number;
  brandIds?: number[];
  sizeIds?: number[];
  userId?: number;
  priceMin?: number;
  priceMax?: number;
  condition?: Array<"new_with_tags" | "new_without_tags" | "very_good" | "good" | "satisfactory">;
  sortBy?: "relevance" | "price_low_to_high" | "price_high_to_low" | "newest_first";
  page?: number;
  perPage?: number;
  isSold?: boolean;
}
