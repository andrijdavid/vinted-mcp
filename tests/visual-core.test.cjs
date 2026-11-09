const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseItem, parseSeller } = require('../dist-ts/vinted-core/parsers/response-parser');
const { buildSearchUrl } = require('../dist-ts/vinted-core/api/endpoints');
const { normalizeSize, sizeMatch } = require('../dist-ts/visual/size');
const { audience, categoryMatches, isDescendant } = require('../dist-ts/visual/catalog');
const { parseItemUrl } = require('../dist-ts/tools/get-item');
const { metadataMatch, visualMatch } = require('../dist-ts/visual/ranking');
const { deduplicate, rejection, searchSimilar } = require('../dist-ts/visual/search');
const { listingRisk, sellerRisk } = require('../dist-ts/visual/risk');
const { outfitCost, optimizeOutfit } = require('../dist-ts/visual/budget');
const { parseOriginalProducts, identifyOriginal, validateProductUrl } = require('../dist-ts/visual/product');
const { extractIdentifiers, validEAN } = require('../dist-ts/visual/identifiers');
const { TTLCache } = require('../dist-ts/visual/common');
const { RateLimiter } = require('../dist-ts/vinted-core/api/rate-limiter');
const { handleSearchItems } = require('../dist-ts/tools/search-items');
const { VintedAPIClient } = require('../dist-ts/vinted-core/api/client');

function item(overrides={}) {
 return { id:42,country:'nl',url:'https://www.vinted.nl/items/42-test',title:'Donkerbruine waffle crewneck heren trui',description:'',
  size:'L',price:15,currency:'EUR',categoryId:1813,color:'donkerbruin',condition:'very_good',
  photos:['https://images1.vinted.net/t/actual/f800/test.webp'],availability:'available',
  seller:{id:5,rating:4.8,ratingCount:40}, ...overrides };
}
test('search filters use current bracketed attributes, sorting and pagination',()=>{
 const u=new URL(buildSearchUrl({query:'jeans',country:'nl',categoryId:257,sizeIds:[1234],brandIds:[10],condition:['very_good'],page:3,perPage:30,priceMin:0,priceMax:20,sortBy:'price_low_to_high'}));
 for (const [key,val] of Object.entries({'attribute_ids[catalog]':'257','attribute_ids[size]':'1234','attribute_ids[brand]':'10','attribute_ids[status]':'2',page:'3',per_page:'30',price_from:'0',price_to:'20',order:'price_low_to_high'})) assert.equal(u.searchParams.get(key),val);
});
test('normalizes exact clothing sizes without converting waist, EU or lengths',()=>{
 for(const [input,expected] of [['L','L'],['L / 40','L'],['W32 L34','W32'],['W32 | FR 42','W32'],['EU 46','EU46'],['46','EU46'],['XXL','XXL'],['Très bon état',null],['Heel goed',null],['UK 12',null]]) assert.equal(normalizeSize(input),expected,input);
 assert.equal(sizeMatch('W32','32'),'mismatch');
 assert.equal(sizeMatch('W32','W32 L30'),'exact');
 assert.equal(sizeMatch('W32',null),'unknown');
});
test('condition-only item box never becomes a size; missing price stays unknown',()=>{
 const parsed=parseItem({id:1,item_box:{first_line:'COS',second_line:'Très bon état'}},'fr');
 assert.equal(parsed.size,null); assert.equal(parsed.condition,'Très bon état'); assert.equal(parsed.price,null); assert.equal(parsed.currency,'');
 const sized=parseItem({id:2,item_box:{second_line:'W32 | FR 42 · Très bon état'},price:{amount:'0',currency_code:'EUR'}},'nl');
 assert.equal(sized.size,'W32 | FR 42'); assert.equal(sized.price,0);
 assert.equal(parseItem({id:3,status:'active'},'nl').condition,null);
});
test('parses structured material, identifiers and actual single catalogue photo with provenance',()=>{
 const parsed=parseItem({id:42,photo:{url:'https://images1.vinted.net/a.webp',thumbnails:[{url:'https://images1.vinted.net/thumb.webp',width:70}]},material:'Cotton',description:'Art. 1234/567/800',color:{title:'Brown'},brand:{title:'Zara'}},'nl');
 assert.equal(parsed.photos.length,1); assert.equal(parsed.photoMetadata[0].source,'vinted_listing');assert.equal(parsed.photoMetadata[0].itemId,42);
 assert.equal(parsed.photoMetadata[0].thumbnailUrl,'https://images1.vinted.net/thumb.webp');assert.deepEqual(parsed.materials,['Cotton']);
 assert.equal(parsed.productIdentifiers[0].value,'1234/567/800');assert.equal(parsed.brand,'Zara');assert.equal(parsed.color,'Brown');
});
test('ratings distinguish absent reputation from actual zero and reject invalid scales',()=>{
 assert.equal(parseSeller({feedback_reputation:0.98},'nl').rating,4.9);
 assert.equal(parseSeller({feedback_reputation:0},'nl').rating,0);
 assert.equal(parseSeller({},'nl').rating,null);
 assert.equal(parseSeller({feedback_reputation:4},'nl').rating,null);
});
test('verified taxonomy distinguishes men, women and kids; jeans is not tshirts',()=>{
 assert.equal(isDescendant(1813,5),true); assert.equal(audience(item({categoryId:1819})),'men');
 assert.equal(audience(item({categoryId:221})),'women');
 assert.equal(audience(item({categoryId:1696})),'kids');
 assert.equal(categoryMatches(item({categoryId:1819}),'jeans'),true);
 assert.equal(categoryMatches(item({categoryId:2050}),'tshirt'),false);
 assert.equal(categoryMatches(item({categoryId:null}),'jeans'),null);
});
test('listing URL parsing rejects forged hosts, wrong paths and protocols',()=>{
 assert.deepEqual(parseItemUrl('https://www.vinted.co.uk/items/42-test'),{id:42,country:'uk'});
 for(const u of ['https://vinted.nl.evil.test/items/42','https://evil.test/vinted.nl/items/42','http://www.vinted.nl/items/42','https://www.vinted.nl/member/42','https://user:password@www.vinted.nl/items/42','https://www.vinted.zz/items/42']) assert.equal(parseItemUrl(u),null,u);
});
test('removes wrong size, audience, category, color, zip crewneck and slim baggy',()=>{
 const sweater={category:'sweater',size:'L',reference:{color:'dark brown',neckline:'crewneck'},exclusions:['zip']};
 assert.equal(rejection(item(),sweater),null);
 for(const bad of [item({size:'M'}),item({title:'Dames trui',categoryId:221}),item({title:'Kids trui',categoryId:1696}),item({title:'Zwarte trui',color:'black'}),item({title:'Brown zip sweater'})]) assert.ok(rejection(bad,sweater));
 assert.ok(rejection(item({title:'beige slim fit jeans',categoryId:1818,size:'W32'}),{category:'jeans',size:'W32',reference:{fit:'baggy'}}));
 assert.ok(rejection(item({title:'Original Timberland Größe 37',size:'Overige',categoryId:2662}),{category:'boots',size:'EU46',reference:{}}));
 assert.ok(rejection(item({title:'Levi’s 511 W32 L30 faded',brand:"Levi's",size:'W32',categoryId:1819}),{category:'jeans',size:'W32',reference:{fit:'baggy'}}));
 assert.equal(rejection(item({title:'Zara baggy beige taille 42 (W32)',size:'W32 | FR 42',categoryId:1819}),{category:'jeans',size:'W32',reference:{fit:'baggy'}}),null);
});
test('deduplicates by country/id and identical main photos',()=>{
 assert.equal(deduplicate([item(),item(),item({id:43}),item({id:44,photos:[]})]).length,2);
});
test('metadata score rewards known features, penalizes wrong model and exposes missing data',()=>{
 const reference={color:'dark brown',texture:'waffle',neckline:'crewneck'};
 const positive=metadataMatch(item(),reference,'sweater');
 const negative=metadataMatch(item({title:'black zip cardigan',color:'black'}),reference,'sweater');
 assert.equal(positive.score,100);assert.ok(negative.score<positive.score);assert.equal(positive.visualScore,null);
 const missing=metadataMatch(item({title:'Trui',description:'',color:null,categoryId:null}),reference,'sweater'); assert.equal(missing.score,0);assert.equal(missing.missing.length,3);
});
test('visual scoring requires actual-photo evidence and scores realistic matches coarsely',()=>{
 const i=item(),ref={color:'dark brown',texture:'waffle',neckline:'crewneck'};
 assert.equal(visualMatch(i,ref,'sweater').score,null);
 const review={observer:'chatgpt_vision',referenceImage:'uploaded-reference-1',candidateImageUrls:i.photos,comparisons:[
  {feature:'color',status:'match',explanation:'Both visibly dark brown'},
  {feature:'texture',status:'close',explanation:'Candidate knit has smaller visible waffle cells'},
  {feature:'neckline',status:'match',explanation:'Both have a round ribbed collar'}]};
 const positive=visualMatch(i,ref,'sweater',review);assert.equal(positive.score,80);assert.equal(positive.coverage,100);assert.equal(positive.status,'caller_image_assessment');
 const negative=visualMatch(i,ref,'sweater',{...review,comparisons:review.comparisons.map(c=>({...c,status:'mismatch'}))});assert.equal(negative.score,0);
 assert.throws(()=>visualMatch(i,ref,'sweater',{...review,candidateImageUrls:['https://images1.vinted.net/wrong.webp']}),/actual photos/);
 assert.throws(()=>visualMatch(i,ref,'sweater',{...review,comparisons:[review.comparisons[0],review.comparisons[0]]}),/unique/);
 const partial=visualMatch(i,ref,'sweater',{...review,comparisons:[review.comparisons[0]]});assert.ok(partial.score<50);assert.equal(partial.missing.length,2);
});
test('seller risk treats new accounts as uncertainty, flags supported serious issues',()=>{
 assert.equal(sellerRisk({rating:null,ratingCount:0}).level,'unknown');
 assert.equal(sellerRisk({rating:2,ratingCount:30}).recommendation,'do_not_recommend');
 assert.equal(listingRisk(item({title:'Replica boots'})).recommendation,'do_not_recommend');
 const flags=listingRisk(item({size:null,photos:[],price:null,condition:null,availability:'unknown'})).flags.join(' ');
 for(const term of ['size','photos','price','Condition','Availability']) assert.ok(flags.includes(term));
 assert.ok(listingRisk(item(),[item({id:43})]).flags.some(v=>v.includes('reused')));
});
test('identification requires verifiable manufacturer data, brand/code and optional observed label',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Textured crewneck',brand:{name:'Zara'},sku:'1234/567/800',color:'Brown',material:'Cotton',image:'https://static.zara.net/original.jpg',offers:{price:'29.95',priceCurrency:'EUR'}})+'</script>';
 const products=parseOriginalProducts(html,'https://www.zara.com/nl/en/product.html');
 const listing=item({brand:'Zara',color:'Brown',productIdentifiers:[{type:'sku',value:'1234/567/800',source:'listing.text'}]});
 assert.equal(identifyOriginal(listing,[]).status,'not_identified');
 assert.equal(identifyOriginal(listing,products).status,'probable_same_model');
 assert.equal(identifyOriginal(listing,products,{photoUrl:listing.photos[0],observedCode:'1234/567/800'}).status,'exact_product_confirmed');
 assert.equal(identifyOriginal({...listing,productIdentifiers:[]},products,{photoUrl:listing.photos[0],observedCode:'1234/567/800'}).status,'exact_product_confirmed');
 assert.equal(identifyOriginal({...listing,productIdentifiers:[]},products).status,'similar_product_only');
 assert.equal(products[0].originalPrice,null);assert.equal(products[0].sourceListedPrice.amount,29.95);
 const browser=products.map(p=>({...p,evidenceMethod:'caller_web_observation'}));
 assert.equal(identifyOriginal(listing,browser,{photoUrl:listing.photos[0],observedCode:'1234/567/800'}).status,'probable_same_model');
 assert.throws(()=>validateProductUrl('https://localhost/product','Zara'),/official/);
 assert.throws(()=>validateProductUrl('https://zara.com.evil.test/product','Zara'),/official/);
 assert.equal(validEAN('4006381333931'),true);assert.equal(validEAN('4006381333932'),false);
 assert.equal(extractIdentifiers({description:'EAN: 4006381333932'}).length,0);
});
test('budget preserves unknown charges, currencies, explicit estimates and same seller bundles',()=>{
 const a=item(),b=item({id:43,price:20});
 const unknown=outfitCost([a,b],'EUR');assert.equal(unknown.listingSubtotal,35);assert.equal(unknown.total.amount,null);assert.equal(unknown.shipping.amount,null);
 const estimate=outfitCost([a,b],'EUR',{shippingPerSeller:4,buyerProtectionFixedPerItem:0.7,buyerProtectionPercent:5,bundleDiscountPercent:10});
 assert.equal(estimate.bundleDiscount.amount,3.5);assert.equal(estimate.shipping.amount,4);assert.equal(estimate.total.amount,38.48);
 assert.equal(outfitCost([a,{...b,currency:'GBP'}],'EUR'),null);
 assert.equal(outfitCost([{...a,price:null}],'EUR'),null);
});
test('optimizer finds affordable complete outfits, avoids duplicates, unknown sizes and unsafe sellers',()=>{
 const candidate=(id,price,extra={})=>item({id,price,photos:[],sizeStatus:'exact',metadataMatch:{score:80},visualMatch:{score:null},risk:{level:'low',recommendation:'eligible'},...extra});
 const result=optimizeOutfit([{id:'sweater',candidates:[candidate(1,80),candidate(2,15)]},{id:'jeans',candidates:[candidate(1,10),candidate(3,20),candidate(4,1,{sizeStatus:'unknown'}),candidate(5,1,{risk:{recommendation:'do_not_recommend'}})]}],40,'EUR');
 assert.ok(result.combinations.length);assert.deepEqual(result.combinations[0].items.map(i=>i.id),[2,1]);
 for(const c of result.combinations) assert.ok(c.cost.knownCostLowerBound<=40);
 assert.equal(result.combinations[0].cost.total.amount,null);
 assert.equal(optimizeOutfit([{id:'a',candidates:[candidate(1,50)]}],10,'EUR').combinations.length,0);
 assert.equal(optimizeOutfit([{id:'a',candidates:[candidate(1,10,{visualMatch:{score:75,criteria:[{feature:'fit',status:'mismatch'}]}})]}],100,'EUR').combinations.length,0);
});
test('search combines strategies, exact filters and detail failures without inventing results',async()=>{
 const calls=[];const fake={searchItems:async(p)=>{calls.push(p);return {items:[item(),item({id:43,size:'M'}),item({id:44,title:'zip hoodie',photos:[]})]}},getItem:async()=>{throw Error('unavailable')}};
 const r=await searchSimilar(fake,{category:'sweater',country:'nl',size:'L',reference:{neckline:'crewneck'},limit:5});
 assert.equal(calls.length,3);assert.ok(calls.every(p=>p.categoryId===79));assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].detailStatus,'unavailable');assert.equal(r.candidates[0].visualMatch.score,null);assert.ok(r.errors.length);
 assert.equal(r.completeness,'fewer_than_five_available_after_filters');
 await assert.rejects(()=>searchSimilar(fake,{category:'jeans',categoryId:221}),/categoryId/);
 const blocked=await searchSimilar({searchItems:async()=>{throw Error('403 restricted')}},{category:'jeans'});assert.equal(blocked.completedStrategies,0);assert.equal(blocked.errors.length,1);
});
test('legacy search fields remain stable; optional enriched fields and pagination work',async()=>{
 const fake={searchItems:async p=>{assert.equal(p.page,2);assert.equal(p.perPage,3);return {items:[item()],totalCount:10,hasMore:true}},getItem:async()=>item({materials:['Wool']})};
 const result=JSON.parse(await handleSearchItems(fake,{query:'trui',country:'nl',page:2,perPage:3,includePhotos:true,includeMaterials:true,includeSellerSummary:true}));
 assert.equal(result.items[0].price,'15 EUR');assert.equal(result.items[0].seller,undefined); // fixture has no username; never fabricated
 assert.deepEqual(result.items[0].materials,['Wool']);assert.equal(result.items[0].sellerSummary.rating,4.8);assert.equal(result.items[0].photos.length,1);
});
test('getItem propagates real failure instead of returning a fictitious zero price',async()=>{
 const client=new VintedAPIClient();client.scrapeItemPage=async()=>{throw Error('unavailable')};
 await assert.rejects(()=>client.getItem(42,'nl'),/unavailable/);
});
test('cached search preserves actual fetch time and does not share mutable result objects',async()=>{
 const client=new VintedAPIClient();let calls=0;
 client.makeRequest=async()=>{calls++;return {items:[{id:42,title:'trui',price:{amount:'15',currency_code:'EUR'}}]}};
 const a=await client.searchItems({query:'trui',country:'nl'});const timestamp=a.items[0].scrapedAt;a.items[0].title='mutated';
 const b=await client.searchItems({query:'trui',country:'nl'});assert.equal(calls,1);assert.equal(b.items[0].scrapedAt,timestamp);assert.equal(b.items[0].title,'trui');
});
test('403 stops immediately and subsequent API requests honor the access cooldown',async()=>{
 const client=new VintedAPIClient({maxRetries:3,requestDelayMs:0,jitterMs:0});
 client.getSession=async()=>({cookies:{},csrfToken:'',country:'nl'});
 const originalFetch=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return new Response('{}',{status:403,headers:{'content-type':'application/json'}})};
 try{
  await assert.rejects(()=>client.searchItems({query:'a',country:'nl'}),/403/);
  await assert.rejects(()=>client.searchItems({query:'b',country:'nl'}),/cooldown/);
  assert.equal(calls,1);
 }finally{global.fetch=originalFetch;}
});
test('TTL cache expires and evicts; rate limiter enforces concurrent admission and spacing',async()=>{
 const cache=new TTLCache(5,1);cache.set('a',1);cache.set('b',2);assert.equal(cache.get('a'),undefined);
 await new Promise(r=>setTimeout(r,10));assert.equal(cache.get('b'),undefined);
 const limiter=new RateLimiter(2,8,0);let active=0,peak=0;const starts=[];
 await Promise.all(Array.from({length:12},()=>limiter.execute(async()=>{active++;peak=Math.max(peak,active);starts.push(Date.now());await new Promise(r=>setTimeout(r,18));active--})));
 assert.ok(peak<=2);assert.ok(starts.at(-1)-starts[0]>=70);
});
