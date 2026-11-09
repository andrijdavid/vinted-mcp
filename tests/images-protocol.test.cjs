const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {CallToolResultSchema}=require('@modelcontextprotocol/sdk/types.js');
const {createServer}=require('../dist-ts/index');
const {ListingImageLoader}=require('../dist-ts/visual/images');
const {allowedImageUrl,readBounded,fetchSameOrigin}=require('../dist-ts/visual/network');
const {parseItemPage}=require('../dist-ts/visual/item-page');
const {handleGetItemImages}=require('../dist-ts/tools/get-item-images');

const photo='https://images1.vinted.net/t/actual/f800/fixture.webp';
const listing={id:42,country:'nl',url:'https://www.vinted.nl/items/42-test',title:'Trui',size:'L',price:15,currency:'EUR',photos:[photo],seller:{id:5,rating:4.9,ratingCount:20},scrapedAt:'2026-11-09T12:00:00Z',availability:'available'};
const bytes=()=>sharp({create:{width:1600,height:1200,channels:3,background:'#997700'}}).webp().toBuffer();

test('image download checks bytes, MIME, format and dimensions; caches and coalesces loads',async()=>{
 const input=await bytes();let calls=0;
 const loader=new ListingImageLoader(async()=>{calls++;return new Response(input,{headers:{'content-type':'image/webp'}})});
 const [a,b]=await Promise.all([loader.load(photo),loader.load(photo)]);
 assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.mimeType,'image/jpeg');assert.ok(a.width<=1000&&a.height<=1000);assert.ok(a.bytes<=300000);
 assert.equal((await sharp(Buffer.from(a.data,'base64')).metadata()).format,'jpeg');
 await loader.load(photo);assert.equal(calls,1);
});
test('image handling refuses arbitrary hosts, redirects, forged MIME, oversize and invalid images',async()=>{
 for(const url of ['http://images1.vinted.net/a','https://127.0.0.1/a','https://images1.vinted.net.evil.test/a','https://images1.vinted.net:8443/a','https://u:p@images1.vinted.net/a']) assert.throws(()=>allowedImageUrl(url));
 const input=await bytes();
 await assert.rejects(()=>new ListingImageLoader(async()=>new Response(input,{headers:{'content-type':'text/html'}})).load(photo),/MIME/);
 await assert.rejects(()=>new ListingImageLoader(async()=>new Response(input,{headers:{'content-type':'image/png'}})).load(photo),/mismatch/);
 await assert.rejects(()=>new ListingImageLoader(async()=>new Response('x',{headers:{'content-type':'image/webp','content-length':'5000000'}})).load(photo),/byte limit/);
 await assert.rejects(()=>new ListingImageLoader(async()=>new Response('not an image',{headers:{'content-type':'image/webp'}})).load(photo));
 await assert.rejects(()=>new ListingImageLoader(async()=>new Response('',{status:302,headers:{location:'https://localhost/'}})).load(photo),/302/);
 await assert.rejects(()=>readBounded(new Response(new Uint8Array(11)),10),/byte limit/);
});
test('image timeouts and restrictions are explicit, failed downloads are not cached',async()=>{
 let calls=0;
 const loader=new ListingImageLoader(async(url,options)=>{assert.ok(options.signal);assert.equal(options.redirect,'error');calls++;throw new DOMException('timed out','TimeoutError')});
 await assert.rejects(()=>loader.load(photo),/timed out/);await assert.rejects(()=>loader.load(photo),/timed out/);assert.equal(calls,2);
 let blocked=0;
 await assert.rejects(()=>new ListingImageLoader(async()=>{blocked++;return new Response('',{status:403})}).load(photo),/403/);assert.equal(blocked,1);
});
test('canonical item redirects stay on the original HTTPS origin',async()=>{
 let calls=0;
 const response=await fetchSameOrigin('https://www.vinted.nl/items/42',{},async url=>{
  calls++;return url.endsWith('/42') ? new Response('',{status:302,headers:{location:'/items/42-test'}}) : new Response('ok');
 });
 assert.equal(await response.text(),'ok');assert.equal(calls,2);
 await assert.rejects(()=>fetchSameOrigin('https://www.vinted.nl/items/42',{},async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/'}})),/Unsafe/);
 await assert.rejects(()=>fetchSameOrigin('https://www.vinted.nl/items/42',{},async()=>new Response('',{status:302,headers:{location:'/loop'}})),/excessive/);
});
test('tool emits real-source image or embedded-resource blocks; metadata mode never downloads',async()=>{
 const input=await bytes(), loader=new ListingImageLoader(async()=>new Response(input,{headers:{'content-type':'image/webp'}}));
 const fake={getItem:async()=>listing};
 const metadata=await handleGetItemImages(fake,{itemId:42,country:'nl'}, {load:()=>{throw Error('must not download')}});
 assert.equal(metadata.content.length,1);assert.equal(metadata.structuredContent.visualAccess,'metadata_only');
 const image=await handleGetItemImages(fake,{itemId:42,country:'nl',includeContent:true},loader);
 assert.equal(CallToolResultSchema.safeParse(image).success,true);assert.equal(image.content[1].type,'image');
 assert.equal(image.structuredContent.images[0].listingUrl,listing.url);assert.equal(image.structuredContent.images[0].contentIndex,1);
 const resource=await handleGetItemImages(fake,{itemId:42,country:'nl',includeContent:true,contentFormat:'resource'},loader);
 assert.equal(CallToolResultSchema.safeParse(resource).success,true);assert.equal(resource.content[1].type,'resource');assert.ok(resource.content[1].resource.blob);
 const missing=await handleGetItemImages({getItem:async()=>({...listing,photos:[]})},{itemId:42,country:'nl'});
 assert.equal(missing.structuredContent.images.length,0);assert.ok(missing.structuredContent.warnings.length);
 await assert.rejects(()=>handleGetItemImages(fake,{url:listing.url,country:'fr'}),/conflicts/);
});
test('inline content is capped at three photos and download failures retain provenance',async()=>{
 let calls=0;
 const fake={getItem:async()=>({...listing,photos:Array.from({length:6},(_,i)=>photo+i)})};
 const result=await handleGetItemImages(fake,{itemId:42,country:'nl',includeContent:true,maxPhotos:6},{load:async()=>{calls++;throw Error('download unavailable')}});
 assert.equal(calls,3);assert.equal(result.structuredContent.images.length,6);assert.equal(result.content.length,1);assert.ok(result.structuredContent.images[0].error);
});
test('item-page parser scopes photos and size metadata to the actual item, not recommendations',()=>{
 const ld={'@type':'Product',name:'Test knit',offers:{price:15,priceCurrency:'EUR',availability:'https://schema.org/InStock',url:listing.url},image:photo};
 const payload={item_id:'42',seller_id:'5',catalog_id:'1813',photos:[{url:photo,width:800,height:1000}],entries:[{code:'size',data:{value:'L'}},{code:'status',data:{value:'Très bon état'}},{code:'color',data:{value:'Brown'}}]};
 const other={item_id:'99',photos:[{url:'https://images1.vinted.net/other.webp'}],entries:[{code:'size',data:{value:'XS'}}]};
 const html='<script type="application/ld+json">'+JSON.stringify(ld)+'</script><script>self.__next_f.push([1,'+JSON.stringify('1:'+JSON.stringify([payload,other])+'\n')+'])</script>';
 const parsed=parseItemPage(html,42,'nl');assert.equal(parsed.size,'L');assert.equal(parsed.condition,'Très bon état');assert.equal(parsed.color,'Brown');assert.deepEqual(parsed.photos,[photo]);assert.equal(parsed.categoryId,1813);assert.equal(parsed.availability,'available');
 assert.throws(()=>parseItemPage('<html>Access restricted</html>',42,'nl'),/no valid product data/);
});
test('MCP client negotiates tools, mixed content, binary resources and errors end to end',async()=>{
 const input=await bytes();
 const loader=new ListingImageLoader(async()=>new Response(input,{headers:{'content-type':'image/webp'}}));
 const api={getItem:async()=>listing,searchItems:async()=>({items:[listing],totalCount:1}),getSeller:async()=>({})};
 const server=createServer({client:api,imageLoader:loader});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 const client=new Client({name:'visual-protocol-test',version:'1'},{capabilities:{}});
 await server.connect(serverTransport);await client.connect(clientTransport);
 try{
  const tools=await client.listTools();assert.equal(tools.tools.length,11);
  assert.ok(tools.tools.filter(t=>['get_item_images','find_original_product','search_similar_items','find_similar_outfit','assess_visual_match'].includes(t.name)).every(t=>t.annotations.readOnlyHint));
  const result=await client.callTool({name:'get_item_images',arguments:{itemId:42,country:'nl',includeContent:true}});assert.equal(result.content[1].type,'image');assert.ok(result.structuredContent.images[0].contentIncluded);
  const resource=await client.readResource({uri:'vinted://image/nl/42/0'});assert.equal(resource.contents[0].mimeType,'image/jpeg');assert.ok(resource.contents[0].blob);
  const error=await client.callTool({name:'get_item_images',arguments:{itemId:-1}});assert.equal(error.isError,true);
  const invalid=await client.callTool({name:'get_item_images',arguments:{itemId:42,includeContent:'yes'}});assert.equal(invalid.isError,true);assert.match(invalid.content[0].text,/Invalid tool arguments/);
  const original=await client.callTool({name:'find_original_product',arguments:{itemId:42,country:'nl'}});assert.equal(JSON.parse(original.content[0].text).status,'not_identified');
  const assessment=await client.callTool({name:'assess_visual_match',arguments:{itemId:42,country:'nl',category:'sweater',reference:{color:'brown'}}});assert.equal(JSON.parse(assessment.content[0].text).visualMatch.score,null);
  const outfitArgs={country:'nl',budget:100,referenceImage:'real-upload-test-fixture',components:[{id:'sweater',category:'sweater',size:'L',reference:{color:'brown'}}],visualReviews:[{componentId:'sweater',itemId:42,review:{observer:'chatgpt_vision',referenceImage:'real-upload-test-fixture',candidateImageUrls:[photo],comparisons:[{feature:'color',status:'match',explanation:'Synthetic observer fixture for protocol verification, not a real image evaluation'}]}}]};
  const outfitResult=await client.callTool({name:'find_similar_outfit',arguments:outfitArgs});assert.notEqual(outfitResult.isError,true);
  const outfit=JSON.parse(outfitResult.content[0].text);assert.equal(outfit.appliedVisualReviews,1);assert.equal(outfit.combinations[0].items[0].visualScore,100);assert.equal(outfit.combinations[0].cost.total.amount,null);
  const conflicting=await client.callTool({name:'find_similar_outfit',arguments:{...outfitArgs,referenceImage:'different-reference'}});assert.equal(conflicting.isError,true);
 }finally{await client.close();await server.close()}
});
