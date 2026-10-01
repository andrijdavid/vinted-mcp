const assert = require("node:assert/strict");
const { test } = require("node:test");

const { VintedAPIClient } = require("../dist-ts/vinted-core/api/client.js");
const { buildFavouriteToggleUrl } = require("../dist-ts/vinted-core/api/endpoints.js");

test("builds the favourite toggle url", () => {
  assert.equal(buildFavouriteToggleUrl("fr"), "https://www.vinted.fr/api/v2/user_favourites/toggle");
});

// The item page embeds its data as an escaped JSON string literal, so the
// stub has to reproduce the backslash-escaped quotes the parser looks for.
function stubClient(isFavourite) {
  const client = new VintedAPIClient();
  const calls = [];

  client.fetchItemPage = async () =>
    `<script type="application/ld+json">{"name":"Test item"}</script>` +
    `<script>self.__next_f.push([1,"{\\"favourite_count\\":3,\\"is_favourite\\":${isFavourite},\\"item_id\\":\\"42\\"}"])</script>`;

  client.makeRequest = async (url, country, options) => {
    calls.push({ url, options });
    return {};
  };

  return { client, calls };
}

test("liking an already-liked item does not toggle it off", async () => {
  const { client, calls } = stubClient(true);
  const result = await client.setFavourite(42, "fr", true);

  assert.equal(result.liked, true);
  assert.equal(result.changed, false);
  assert.equal(result.title, "Test item");
  assert.equal(calls.length, 0);
});

test("liking an unliked item posts the toggle", async () => {
  const { client, calls } = stubClient(false);
  const result = await client.setFavourite(42, "fr", true);

  assert.equal(result.liked, true);
  assert.equal(result.changed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, buildFavouriteToggleUrl("fr"));
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.body, { type: "item", user_favourites: [42] });
});

test("unliking a liked item posts the toggle", async () => {
  const { client, calls } = stubClient(true);
  const result = await client.setFavourite(42, "fr", false);

  assert.equal(result.liked, false);
  assert.equal(result.changed, true);
  assert.equal(calls.length, 1);
});

test("refuses to toggle blind when the item page state cannot be read", async () => {
  const { client } = stubClient(true);
  client.fetchItemPage = async () => "<html>no embedded state</html>";

  await assert.rejects(() => client.setFavourite(42, "fr", true), /favourite state/);
});
