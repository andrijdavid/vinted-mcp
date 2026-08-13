const assert = require("node:assert/strict");
const { test } = require("node:test");

const { VintedAPIClient } = require("../dist-ts/vinted-core/api/client.js");
const { buildFavouriteToggleUrl } = require("../dist-ts/vinted-core/api/endpoints.js");

test("builds the favourite toggle url", () => {
  assert.equal(buildFavouriteToggleUrl("fr"), "https://www.vinted.fr/api/v2/user_favourites/toggle");
});

function stubClient(isFavourite) {
  const client = new VintedAPIClient();
  const calls = [];

  client.makeRequest = async (url, country, options) => {
    calls.push({ url, options });
    return { item: { id: 42, title: "Test item", is_favourite: isFavourite } };
  };

  return { client, calls };
}

test("liking an already-liked item does not toggle it off", async () => {
  const { client, calls } = stubClient(true);
  const result = await client.setFavourite(42, "fr", true);

  assert.equal(result.liked, true);
  assert.equal(result.changed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options, undefined);
});

test("liking an unliked item posts the toggle", async () => {
  const { client, calls } = stubClient(false);
  const result = await client.setFavourite(42, "fr", true);

  assert.equal(result.liked, true);
  assert.equal(result.changed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, buildFavouriteToggleUrl("fr"));
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(calls[1].options.body, { type: "item", user_favourites: [42] });
});

test("unliking a liked item posts the toggle", async () => {
  const { client, calls } = stubClient(true);
  const result = await client.setFavourite(42, "fr", false);

  assert.equal(result.liked, false);
  assert.equal(result.changed, true);
  assert.equal(calls.length, 2);
});
