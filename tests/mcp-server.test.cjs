const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const runLiveTests = process.env.RUN_LIVE_MCP_TESTS === "1";

let client;

before(async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/bundle.js"],
    cwd: process.cwd(),
    env: { ...process.env }
  });

  client = new Client(
    {
      name: "mcp-server-test-client",
      version: "1.0.0"
    },
    {
      capabilities: {}
    }
  );

  await client.connect(transport);
});

after(async () => {
  if (client) {
    await client.close();
  }
});

test("lists tools", async () => {
  const response = await client.listTools();
  const names = (response.tools || []).map((tool) => tool.name);

  assert.deepEqual(names.sort(), [
    "compare_prices",
    "get_item",
    "get_seller",
    "get_trending",
    "like_item",
    "search_items"
  ]);
});

test("lists resources", async () => {
  const response = await client.listResources();
  const uris = (response.resources || []).map((resource) => resource.uri).sort();

  assert.deepEqual(uris, ["vinted://categories", "vinted://countries"]);
});

test("lists resource templates", async () => {
  const response = await client.listResourceTemplates();
  const templates = response.resourceTemplates || [];
  const templateUris = templates.map((template) => template.uriTemplate).sort();

  assert.deepEqual(templateUris, [
    "vinted://item/{country}/{itemId}",
    "vinted://search/{country}/{query}",
    "vinted://seller/{country}/{sellerId}"
  ]);
});

test("lists and resolves prompts", async () => {
  const list = await client.listPrompts();
  const names = (list.prompts || []).map((prompt) => prompt.name).sort();

  assert.deepEqual(names, [
    "buy_or_skip_decision",
    "find_best_deal",
    "resale_arbitrage_estimator",
    "screen_seller",
    "search_item_with_filters",
    "trending_report"
  ]);

  const prompt = await client.getPrompt({
    name: "find_best_deal",
    arguments: {
      item: "nike air max",
      countries: "fr,de",
      maxPrice: "50"
    }
  });

  assert.equal(Array.isArray(prompt.messages), true);
  assert.equal(prompt.messages.length > 0, true);
  const first = prompt.messages[0];
  assert.equal(first.role, "user");
  assert.equal(first.content.type, "text");
  assert.equal(first.content.text.includes("nike air max"), true);

  const filteredPrompt = await client.getPrompt({
    name: "search_item_with_filters",
    arguments: {
      item: "nike dunk",
      country: "fr",
      size: "42",
      brand: "Nike",
      maxPrice: "100",
      limit: "10"
    }
  });

  assert.equal(Array.isArray(filteredPrompt.messages), true);
  assert.equal(filteredPrompt.messages.length > 0, true);
  const filteredText = filteredPrompt.messages[0].content.text;
  assert.equal(filteredText.includes("size 42"), true);
  assert.equal(filteredText.includes("brand Nike"), true);

  const decisionPrompt = await client.getPrompt({
    name: "buy_or_skip_decision",
    arguments: {
      itemId: "4283719503",
      country: "fr",
      compareQuery: "nike dunk low",
      compareCountries: "fr,de,it",
      budget: "120"
    }
  });

  assert.equal(Array.isArray(decisionPrompt.messages), true);
  assert.equal(decisionPrompt.messages.length > 0, true);
  const decisionText = decisionPrompt.messages[0].content.text;
  assert.equal(decisionText.includes("get_item"), true);
  assert.equal(decisionText.includes("get_seller"), true);
  assert.equal(decisionText.includes("compare_prices"), true);

  const resalePrompt = await client.getPrompt({
    name: "resale_arbitrage_estimator",
    arguments: {
      item: "new balance 2002r",
      buyCountry: "fr",
      sellCountry: "de",
      shippingCost: "8",
      feePct: "12",
      limit: "20"
    }
  });

  assert.equal(Array.isArray(resalePrompt.messages), true);
  assert.equal(resalePrompt.messages.length > 0, true);
  const resaleText = resalePrompt.messages[0].content.text;
  assert.equal(resaleText.includes("compare_prices"), true);
  assert.equal(resaleText.includes("net expected profit"), true);
});

test("reads countries and categories resources", async () => {
  const countriesRes = await client.readResource({ uri: "vinted://countries" });
  const countries = JSON.parse(getText(countriesRes));
  assert.ok(Array.isArray(countries));
  assert.ok(countries.length >= 19);

  const categoriesRes = await client.readResource({ uri: "vinted://categories" });
  const categories = JSON.parse(getText(categoriesRes));
  assert.ok(Array.isArray(categories));
  assert.ok(categories.length > 0);
});

test(
  "runs live tool flow",
  {
    skip: !runLiveTests
  },
  async () => {
    const searchResult = await client.callTool({
      name: "search_items",
      arguments: { query: "nike", country: "fr", limit: 2 }
    });
    assert.equal(searchResult.isError, undefined);

    const search = JSON.parse(getText(searchResult));
    assert.ok(Array.isArray(search.items));
    assert.ok(search.items.length > 0);
    assert.ok(search.items[0].brand, "search results should carry a brand");
    assert.ok(parseFloat(search.items[0].price) > 0, "search results should carry a price");

    const itemId = search.items[0].id;
    assert.equal(typeof itemId, "number");

    const itemResult = await client.callTool({
      name: "get_item",
      arguments: { itemId, country: "fr" }
    });
    assert.equal(itemResult.isError, undefined);
    const item = JSON.parse(getText(itemResult));
    assert.equal(item.id, itemId);
    assert.ok(item.title, "item detail should carry a title");
    assert.ok(item.description, "item detail should carry a description");
    assert.ok(item.seller.username, "item detail should carry a resolved seller");

    const sellerId = item.seller.id;
    assert.ok(sellerId > 0, "item detail should carry a seller id");
    const sellerResult = await client.callTool({
      name: "get_seller",
      arguments: { sellerId, country: "fr", includeItems: true, itemLimit: 2 }
    });
    assert.equal(sellerResult.isError, undefined);
    const seller = JSON.parse(getText(sellerResult));
    assert.equal(typeof seller.id, "number");
    assert.equal(seller.username, item.seller.username);
    assert.ok(seller.rating === null || (seller.rating >= 0 && seller.rating <= 5), "rating is on a 0-5 scale");
    assert.ok(Array.isArray(seller.recentReviews));

    const compareResult = await client.callTool({
      name: "compare_prices",
      arguments: { query: "nike", countries: ["fr", "de"], limit: 5 }
    });
    assert.equal(compareResult.isError, undefined);
    const compare = JSON.parse(getText(compareResult));
    assert.ok(Array.isArray(compare.countries));

    const trendingResult = await client.callTool({
      name: "get_trending",
      arguments: { country: "fr", limit: 3 }
    });
    assert.equal(trendingResult.isError, undefined);
    const trending = JSON.parse(getText(trendingResult));
    assert.ok(Array.isArray(trending.trendingItems));
  }
);

function getText(response) {
  const toolText = response?.content?.find((entry) => entry.type === "text")?.text;
  if (typeof toolText === "string") {
    return toolText;
  }

  const resourceText = response?.contents?.find((entry) => typeof entry?.text === "string")?.text;
  if (typeof resourceText === "string") {
    return resourceText;
  }

  assert.fail("Expected text content in MCP response");
}
