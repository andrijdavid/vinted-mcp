import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { getRuntimeConfig } from "./env";
import { getCategoriesData, categoriesResource } from "./resources/categories";
import { getCountriesData, countriesResource } from "./resources/countries";
import { comparePricesTool, handleComparePrices } from "./tools/compare-prices";
import { getItemTool, handleGetItem } from "./tools/get-item";
import { getSellerTool, handleGetSeller } from "./tools/get-seller";
import { getTrendingTool, handleGetTrending } from "./tools/get-trending";
import { handleLikeItem, likeItemTool } from "./tools/like-item";
import { handleSearchItems, searchItemsTool } from "./tools/search-items";
import { VintedAPIClient } from "./vinted-core";

const TOOLS = [searchItemsTool, getItemTool, getSellerTool, comparePricesTool, getTrendingTool, likeItemTool];
const RESOURCES = [countriesResource, categoriesResource];
const RESOURCE_TEMPLATES = [
  {
    name: "Vinted Item By ID",
    uriTemplate: "vinted://item/{country}/{itemId}",
    description: "Returns full item details for a given country code and item ID.",
    mimeType: "application/json"
  },
  {
    name: "Vinted Seller By ID",
    uriTemplate: "vinted://seller/{country}/{sellerId}",
    description: "Returns seller profile details and recent items for a given seller ID.",
    mimeType: "application/json"
  },
  {
    name: "Vinted Search Query",
    uriTemplate: "vinted://search/{country}/{query}",
    description: "Runs a quick search query in a country and returns a result page.",
    mimeType: "application/json"
  }
];

const PROMPTS = [
  {
    name: "find_best_deal",
    description: "Compare listing prices and identify the best value for an item.",
    arguments: [
      { name: "item", description: "Item keywords to search for", required: true },
      { name: "countries", description: "Comma separated country codes, for example fr,de,it", required: false },
      { name: "maxPrice", description: "Optional price ceiling", required: false }
    ]
  },
  {
    name: "screen_seller",
    description: "Review a seller profile and highlight trust signals and risk flags.",
    arguments: [
      { name: "sellerId", description: "Seller ID", required: true },
      { name: "country", description: "Country code", required: true }
    ]
  },
  {
    name: "trending_report",
    description: "Create a short report of trending listings and potential demand signals.",
    arguments: [
      { name: "country", description: "Country code", required: true },
      { name: "query", description: "Optional keyword filter", required: false },
      { name: "limit", description: "How many trending items to include", required: false }
    ]
  },
  {
    name: "search_item_with_filters",
    description: "Search a given item with size and optional brand filters.",
    arguments: [
      { name: "item", description: "Item keywords to search for", required: true },
      { name: "country", description: "Country code", required: true },
      { name: "size", description: "Size label to match, for example M, L, 42", required: true },
      { name: "brand", description: "Optional preferred brand name", required: false },
      { name: "maxPrice", description: "Optional maximum price", required: false },
      { name: "condition", description: "Optional condition preference", required: false },
      { name: "limit", description: "Optional maximum number of results", required: false }
    ]
  },
  {
    name: "buy_or_skip_decision",
    description: "Analyse one listing, check seller quality, compare market prices, and give a buy or skip recommendation.",
    arguments: [
      { name: "itemId", description: "Listing item ID to review", required: true },
      { name: "country", description: "Country code", required: true },
      { name: "compareQuery", description: "Optional query for market comparison", required: false },
      { name: "compareCountries", description: "Optional comma separated country list, for example fr,de,it", required: false },
      { name: "budget", description: "Optional budget ceiling", required: false }
    ]
  },
  {
    name: "resale_arbitrage_estimator",
    description: "Estimate cross-country resale margin after shipping and platform fees.",
    arguments: [
      { name: "item", description: "Item keywords to evaluate", required: true },
      { name: "buyCountry", description: "Country where you plan to buy", required: true },
      { name: "sellCountry", description: "Country where you plan to sell", required: true },
      { name: "shippingCost", description: "Estimated shipping cost in sell currency", required: false },
      { name: "feePct", description: "Estimated platform fee percentage", required: false },
      { name: "limit", description: "Items per country to sample", required: false }
    ]
  }
];

export function createServer(): Server {
  const server = new Server(
    {
      name: "vinted-mcp",
      version: "1.0.1"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  let client: VintedAPIClient | null = null;

  function getClient(): VintedAPIClient {
    if (!client) {
      const runtime = getRuntimeConfig();
      client = new VintedAPIClient({
        authMode: runtime.authMode,
        proxyUrl: runtime.proxyUrl,
        maxConcurrency: runtime.maxConcurrency,
        requestDelayMs: runtime.requestDelayMs,
        maxRetries: runtime.maxRetries
      });
    }

    return client;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments || {};
    const apiClient = getClient();

    try {
      let result: string;

      switch (name) {
        case "search_items":
          result = await handleSearchItems(apiClient, args);
          break;
        case "get_item":
          result = await handleGetItem(apiClient, args);
          break;
        case "get_seller":
          result = await handleGetSeller(apiClient, args);
          break;
        case "compare_prices":
          result = await handleComparePrices(apiClient, args);
          break;
        case "get_trending":
          result = await handleGetTrending(apiClient, args);
          break;
        case "like_item":
          result = await handleLikeItem(apiClient, args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: "text", text: result }]
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const apiClient = getClient();

    switch (uri) {
      case "vinted://countries":
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: getCountriesData()
            }
          ]
        };
      case "vinted://categories":
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: getCategoriesData()
            }
          ]
        };
      default:
        break;
    }

    const itemMatch = uri.match(/^vinted:\/\/item\/([a-z]{2})\/(\d+)$/i);
    if (itemMatch) {
      const country = itemMatch[1].toLowerCase();
      const itemId = Number.parseInt(itemMatch[2], 10);
      const item = await apiClient.getItem(itemId, country);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(item, null, 2)
          }
        ]
      };
    }

    const sellerMatch = uri.match(/^vinted:\/\/seller\/([a-z]{2})\/(\d+)$/i);
    if (sellerMatch) {
      const country = sellerMatch[1].toLowerCase();
      const sellerId = Number.parseInt(sellerMatch[2], 10);
      const seller = await apiClient.getSeller(sellerId, country);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(seller, null, 2)
          }
        ]
      };
    }

    const searchMatch = uri.match(/^vinted:\/\/search\/([a-z]{2})\/(.+)$/i);
    if (searchMatch) {
      const country = searchMatch[1].toLowerCase();
      const query = decodeURIComponent(searchMatch[2]);
      const result = await apiClient.searchItems({
        query,
        country,
        page: 1,
        perPage: 20,
        sortBy: "relevance"
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};

    if (name === "find_best_deal") {
      const item = args.item || "item";
      const countries = args.countries || "fr,de,it,es,nl,pl";
      const maxPrice = args.maxPrice ? ` and keep results under ${args.maxPrice}` : "";
      return {
        description: "Find the best listing across multiple countries.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Find the best deal for ${item} on Vinted in countries ${countries}${maxPrice}. ` +
                "Use search_items and compare_prices. Return top options with short rationale and links."
            }
          }
        ]
      };
    }

    if (name === "screen_seller") {
      const sellerId = args.sellerId || "seller_id";
      const country = args.country || "fr";
      return {
        description: "Review a seller profile and risk signals.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Review seller ${sellerId} in ${country}. Use get_seller and summarise trust signals, ` +
                "possible risks, item quality clues, and whether to buy."
            }
          }
        ]
      };
    }

    if (name === "trending_report") {
      const country = args.country || "fr";
      const query = args.query ? ` for query ${args.query}` : "";
      const limit = args.limit || "20";
      return {
        description: "Generate a concise trending report.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Create a trending report for ${country}${query}. Use get_trending with limit ${limit}. ` +
                "List top items, explain trend signals, and suggest what to monitor next."
            }
          }
        ]
      };
    }

    if (name === "search_item_with_filters") {
      const item = args.item || "item";
      const country = args.country || "fr";
      const size = args.size || "M";
      const brandClause = args.brand ? ` and brand ${args.brand}` : "";
      const maxPriceClause = args.maxPrice ? ` and max price ${args.maxPrice}` : "";
      const conditionClause = args.condition ? ` and condition ${args.condition}` : "";
      const limit = args.limit || "20";

      return {
        description: "Search an item with size and optional brand constraints.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Search Vinted in ${country} for ${item} with size ${size}${brandClause}${maxPriceClause}${conditionClause}. ` +
                `Use search_items and return up to ${limit} best matches with title, price, condition, size, brand, and link.`
            }
          }
        ]
      };
    }

    if (name === "buy_or_skip_decision") {
      const itemId = args.itemId || "item_id";
      const country = args.country || "fr";
      const compareQuery = args.compareQuery || "the same item keyword";
      const compareCountries = args.compareCountries || country;
      const budgetClause = args.budget ? ` Budget limit is ${args.budget}.` : "";

      return {
        description: "Decide whether a listing is a good buy based on item details, seller trust, and market comparison.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Evaluate whether to buy item ${itemId} in ${country}.` +
                ` First use get_item, then use get_seller for that seller, then use compare_prices with query ${compareQuery} across ${compareCountries}.` +
                ` Return a final Buy or Skip decision with confidence score (0-100), key risks, price fairness, and negotiation tips.${budgetClause}`
            }
          }
        ]
      };
    }

    if (name === "resale_arbitrage_estimator") {
      const item = args.item || "item";
      const buyCountry = args.buyCountry || "fr";
      const sellCountry = args.sellCountry || "de";
      const shippingCost = args.shippingCost || "0";
      const feePct = args.feePct || "10";
      const limit = args.limit || "20";

      return {
        description: "Estimate resale opportunity between two countries.",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Estimate arbitrage for ${item}. Use compare_prices across ${buyCountry} and ${sellCountry} with limit ${limit}. ` +
                `Then calculate expected margin if buying in ${buyCountry} and selling in ${sellCountry}, ` +
                `including shipping cost ${shippingCost} and fee ${feePct} percent. ` +
                "Return gross spread, net expected profit, ROI percentage, key risks, and a go or no-go recommendation."
            }
          }
        ]
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}

export async function startServer(): Promise<void> {
  const mode = (process.env.VINTED_MCP_TRANSPORT || "stdio").toLowerCase();

  if (mode === "http" || mode === "tcp") {
    const cleanup = await startHttpTransports();

    process.on?.("SIGINT", async () => {
      await cleanup();
      process.exit?.(0);
    });

    process.on?.("SIGTERM", async () => {
      await cleanup();
      process.exit?.(0);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    process.on?.("SIGINT", async () => {
      await server.close();
      process.exit?.(0);
    });

    process.on?.("SIGTERM", async () => {
      await server.close();
      process.exit?.(0);
    });
  }
}

async function startHttpTransports(): Promise<() => Promise<void>> {
  const http = require("node:http") as {
    createServer: (handler: (req: any, res: any) => void) => {
      listen: (port: number, host: string, cb: () => void) => void;
      close: (cb: () => void) => void;
    };
  };
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js") as {
    StreamableHTTPServerTransport: new (options?: Record<string, unknown>) => any;
  };
  const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js") as {
    SSEServerTransport: new (endpoint: string, res: any, options?: Record<string, unknown>) => any;
  };

  const host = process.env.VINTED_MCP_HOST || "127.0.0.1";
  const port = parsePort(process.env.VINTED_MCP_PORT, 3001);
  const path = process.env.VINTED_MCP_PATH || "/mcp";
  const legacyEnabled = parseBoolean(process.env.VINTED_MCP_ENABLE_LEGACY_SSE, true);
  const legacySsePath = process.env.VINTED_MCP_LEGACY_SSE_PATH || "/sse";
  const legacyMessagesPath = process.env.VINTED_MCP_LEGACY_MESSAGES_PATH || "/messages";

  const streamableServer = createServer();

  const transport: any = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  await streamableServer.connect(transport);

  const legacySessions = new Map<string, { server: Server; transport: any }>();

  const cleanupLegacySession = async (sessionId: string): Promise<void> => {
    const session = legacySessions.get(sessionId);
    if (!session) {
      return;
    }

    legacySessions.delete(sessionId);
    try {
      await session.transport.close();
    } catch {
      // Ignore session transport close errors.
    }
    try {
      await session.server.close();
    } catch {
      // Ignore session server close errors.
    }
  };

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (url.pathname === path) {
      transport.handleRequest(req, res).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        writeJsonError(res, 500, message);
      });
      return;
    }

    if (legacyEnabled && url.pathname === legacySsePath && req.method === "GET") {
      const legacyServer = createServer();
      const legacyTransport = new SSEServerTransport(legacyMessagesPath, res);

      try {
        await legacyServer.connect(legacyTransport);
        const sessionId = String(legacyTransport.sessionId);
        legacySessions.set(sessionId, { server: legacyServer, transport: legacyTransport });

        legacyTransport.onclose = () => {
          cleanupLegacySession(sessionId).catch(() => undefined);
        };

        await legacyTransport.start();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        writeJsonError(res, 500, message);
        await legacyServer.close().catch(() => undefined);
      }
      return;
    }

    if (legacyEnabled && url.pathname === legacyMessagesPath && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId") || "";
      const session = legacySessions.get(sessionId);

      if (!session) {
        writeJsonError(res, 400, "Missing or invalid legacy SSE sessionId");
        return;
      }

      session.transport.handlePostMessage(req, res).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        writeJsonError(res, 500, message);
      });
      return;
    }

    if (legacyEnabled && (url.pathname === legacySsePath || url.pathname === legacyMessagesPath)) {
      writeJsonError(res, 405, "Method not allowed");
      return;
    }

    if (url.pathname === "/") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          streamableHttp: path,
          legacySse: legacyEnabled ? legacySsePath : null,
          legacyMessages: legacyEnabled ? legacyMessagesPath : null
        })
      );
      return;
    }

    writeJsonError(res, 404, "Not found");
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, resolve);
  });

  console.error(`[vinted-mcp] Streamable HTTP listening on http://${host}:${port}${path}`);
  if (legacyEnabled) {
    console.error(`[vinted-mcp] Legacy SSE listening on http://${host}:${port}${legacySsePath}`);
    console.error(`[vinted-mcp] Legacy message endpoint http://${host}:${port}${legacyMessagesPath}`);
  }

  return async () => {
    for (const sessionId of Array.from(legacySessions.keys())) {
      await cleanupLegacySession(sessionId);
    }

    await streamableServer.close().catch(() => undefined);

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  };
}

function writeJsonError(res: any, statusCode: number, message: string): void {
  if (res.headersSent) {
    return;
  }

  try {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: message }));
  } catch {
    // Ignore response write failures.
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalised = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalised)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalised)) {
    return false;
  }

  return fallback;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}
