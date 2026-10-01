export interface VintedCountry {
  code: string;
  domain: string;
  currency: string;
  language: string;
  name: string;
}

export const VINTED_COUNTRIES: Record<string, VintedCountry> = {
  fr: { code: "fr", domain: "www.vinted.fr", currency: "EUR", language: "fr", name: "France" },
  de: { code: "de", domain: "www.vinted.de", currency: "EUR", language: "de", name: "Germany" },
  uk: { code: "uk", domain: "www.vinted.co.uk", currency: "GBP", language: "en", name: "United Kingdom" },
  it: { code: "it", domain: "www.vinted.it", currency: "EUR", language: "it", name: "Italy" },
  es: { code: "es", domain: "www.vinted.es", currency: "EUR", language: "es", name: "Spain" },
  nl: { code: "nl", domain: "www.vinted.nl", currency: "EUR", language: "nl", name: "Netherlands" },
  pl: { code: "pl", domain: "www.vinted.pl", currency: "PLN", language: "pl", name: "Poland" },
  pt: { code: "pt", domain: "www.vinted.pt", currency: "EUR", language: "pt", name: "Portugal" },
  be: { code: "be", domain: "www.vinted.be", currency: "EUR", language: "fr", name: "Belgium" },
  at: { code: "at", domain: "www.vinted.at", currency: "EUR", language: "de", name: "Austria" },
  lt: { code: "lt", domain: "www.vinted.lt", currency: "EUR", language: "lt", name: "Lithuania" },
  cz: { code: "cz", domain: "www.vinted.cz", currency: "CZK", language: "cs", name: "Czech Republic" },
  sk: { code: "sk", domain: "www.vinted.sk", currency: "EUR", language: "sk", name: "Slovakia" },
  hu: { code: "hu", domain: "www.vinted.hu", currency: "HUF", language: "hu", name: "Hungary" },
  ro: { code: "ro", domain: "www.vinted.ro", currency: "RON", language: "ro", name: "Romania" },
  hr: { code: "hr", domain: "www.vinted.hr", currency: "EUR", language: "hr", name: "Croatia" },
  fi: { code: "fi", domain: "www.vinted.fi", currency: "EUR", language: "fi", name: "Finland" },
  dk: { code: "dk", domain: "www.vinted.dk", currency: "DKK", language: "da", name: "Denmark" },
  se: { code: "se", domain: "www.vinted.se", currency: "SEK", language: "sv", name: "Sweden" }
};

export const SUPPORTED_COUNTRY_CODES = Object.keys(VINTED_COUNTRIES);

export function getCountry(code: string): VintedCountry {
  const country = VINTED_COUNTRIES[code.toLowerCase()];
  if (!country) {
    throw new Error(`Unsupported country code: ${code}. Supported: ${SUPPORTED_COUNTRY_CODES.join(", ")}`);
  }
  return country;
}

export function getBaseUrl(country: string): string {
  return `https://${getCountry(country).domain}`;
}

export function getApiBaseUrl(country: string): string {
  return `https://${getCountry(country).domain.replace(/^www\./, "api.")}`;
}
