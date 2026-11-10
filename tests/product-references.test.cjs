const {test}=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const Ajv=require('ajv');
const {ReferenceHttp,publicHttps,publicIPv4,pinnedHttps}=require('../dist-ts/visual/reference-network');
const {ReferenceService,classifyReference,colorAgreement,imageObservation,fitComparison}=require('../dist-ts/visual/references');
const {sourceInfo,referenceQueries,jsonLdAdapter,BraveSearchProvider,parseShopifyProduct,loadProductPage}=require('../dist-ts/visual/reference-sources');
const {extractIdentifiers,validGTIN}=require('../dist-ts/visual/identifiers');
const {findProductReferenceImagesTool,handleFindProductReferenceImages,enrichSelectedReferences}=require('../dist-ts/tools/find-product-reference-images');
const {handleFindOriginalProduct}=require('../dist-ts/tools/find-original-product');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {createServer}=require('../dist-ts/index');
const listingPhoto='https://images1.vinted.net/t/reference-fixture.webp';
const page='https://www.cos.com/en-nl/product/rib-knit.html';
const image='https://media.cos.com/rib-knit-front.webp';
const item=(extra={})=>({id:42,country:'nl',url:'https://www.vinted.nl/items/42-test',title:'Brown rib knit sweater crewneck',brand:'COS',color:'Brown',price:15,currency:'EUR',size:'L',condition:'Very good',photos:[listingPhoto],seller:{id:5,rating:4.9,ratingCount:20},productIdentifiers:[{type:'sku',value:'1234567890',source:'listing.text'}],...extra});
const product=(extra={})=>({'@type':'Product',name:'Rib-knit crewneck sweater',brand:{name:'COS'},sku:'1234567890',color:'Brown',material:'Cotton',image:[{'@type':'ImageObject',url:image,caption:'Worn by model front view'}],...extra});
const html=p=>'<script type="application/ld+json">'+JSON.stringify(p)+'</script>';
const body=(s,mime='text/html')=>({bytes:Buffer.from(s),mime,retrievedAt:'2026-11-10T10:00:00Z'});
const label={photoUrl:listingPhoto,observedCode:'1234567890'};
const png=()=>sharp({create:{width:200,height:400,channels:3,background:'#552211'}}).webp().toBuffer();
async function fixture(p=product(),options={}) {
 const bytes=await png(),otherBytes=await sharp({create:{width:200,height:400,channels:3,background:'#664433'}}).webp().toBuffer(),calls=[];
 const http=new ReferenceHttp(async(url,max,headers)=>{calls.push({url,max,headers});
  if(url===page) {if(options.fail) throw Error(options.fail);return body(html(p));}
  if(options.failImages) throw Error('Image unavailable');
  return body(url===image?bytes:otherBytes,'image/webp');
 });
 const service=new ReferenceService(http,options.provider||{name:'fixture_no_search',available:false,search:async()=>[]});
 return {service,calls,bytes};
}
const observations=(imageUrl=image)=>({sourceUrl:page,name:'Brown rib crewneck',brand:'COS',modelCode:'1234567890',color:'Brown',observation:'Product page and model photo inspected',images:[{imageUrl,imageType:'model_front',onModel:true,observer:'chatgpt_vision',observation:'Torso, shoulders and sleeves visible on a model'}],comparison:{listingPhotoUrl:listingPhoto,referenceImageUrl:imageUrl,observer:'chatgpt_vision',features:['category','color','fit','silhouette','length','texture','neckline'].map(feature=>({feature,status:'close',explanation:`Comparable ${feature} observed on both photos`}))}});

test('product identifiers support valid GTIN variants and reject malformed checksum claims',()=>{
 assert.ok(validGTIN('4006381333931'));assert.ok(validGTIN('036000291452'));assert.ok(validGTIN('96385074'));assert.ok(!validGTIN('4006381333932'));
 const ids=extractIdentifiers({sku:'TB010061713',mpn:'010061',gtin13:'4006381333932',description:'SKU: 1234/567/800 EAN: 4006381333931'});
 assert.ok(ids.some(i=>i.value==='1234/567/800'));assert.ok(ids.some(i=>i.value==='4006381333931'));assert.ok(!ids.some(i=>i.value==='4006381333932'));
});
test('A: observed listing code + fetched official product/color establishes exact identity with bound on-model image',async()=>{
 const {service}=await fixture();const r=await service.find(item(),{sourceUrls:[page],labelEvidence:label});
 assert.equal(r.identificationStatus,'exact_verified');assert.equal(r.originalProductPageUrl,page);assert.equal(r.referenceImages.length,1);
 const i=r.referenceImages[0];assert.equal(i.sourceTier,'A');assert.equal(i.onModel,true);assert.equal(i.imageType,'model_front');assert.equal(i.sourcePageUrl,page);
 assert.equal(i.verificationEvidence.imageAssociation,'product_jsonld_image');assert.equal(i.verificationEvidence.labelEvidence.photoUrl,listingPhoto);assert.equal(i.retrievedAt,'2026-11-10T10:00:00Z');
 assert.equal(r.vintedImages[0].role,'actual_offered_item_condition_evidence');
});
test('B: retailer sources preserve provenance and never masquerade as official manufacturer pages',async()=>{
 const retailer='https://www.zalando.nl/cos-crewneck.html';const {service}=await fixture();
 const get=service.http.get.bind(service.http);service.http.get=async(url,kind,...rest)=>get(url===retailer?page:url,kind,...rest);
 const r=await service.find(item(),{sourceUrls:[retailer],labelEvidence:label});
 assert.equal(r.identificationStatus,'exact_verified');assert.equal(r.originalProductPageUrl,null);assert.equal(r.productPageUrl,retailer);assert.equal(r.referenceImages[0].sourceDomain,'zalando.nl');assert.equal(r.referenceImages[0].sourceTier,'B');
});
test('C: vintage Trussardi receives a DIFFERENT COS model reference only after both actual images are compared',async()=>{
 const {service}=await fixture();const vintage=item({brand:'Trussardi',title:'Vintage brown rib sweater crewneck',productIdentifiers:[]});
 const noReview=await service.find(vintage,{sourceUrls:[page]});assert.equal(noReview.identificationStatus,'not_found');
 const r=await service.find(vintage,{sourceUrls:[page],webEvidence:[observations()]});
 assert.equal(r.identificationStatus,'similar_reference');assert.equal(r.identifiedProduct,null);assert.equal(r.referenceProduct.brand,'COS');assert.equal(r.originalProductPageUrl,null);assert.equal(r.productCode,null);assert.equal(r.matchingSources.length,0);
 assert.equal(r.referenceImages[0].fitComparison.identityClaim,'different_product');assert.equal(r.referenceImages[0].verificationEvidence.onModelEvidence.method,'caller_image_observation');
 const disabled=await service.find(vintage,{sourceUrls:[page],webEvidence:[observations()],allowSimilar:false});assert.equal(disabled.identificationStatus,'not_found');assert.deepEqual(disabled.referenceImages,[]);
});
test('D: different color/model and same brand alone never establish exact or probable identity',async()=>{
 const {service}=await fixture(product({color:'Blue'}));const r=await service.find(item(),{sourceUrls:[page],labelEvidence:label});assert.equal(r.identificationStatus,'not_found');
 const p={brand:'COS',identifiers:[],source:{tier:'A'},color:'Brown',evidenceMethod:'server_fetched_jsonld'};
 assert.equal(classifyReference(item(),p,label).status,'similar_reference');
 assert.equal(classifyReference(item({model:'Original model'}),{...p,model:'Different model',identifiers:[{value:'1234567890'}]},label).status,'similar_reference');
 assert.equal(colorAgreement('bruin','brown'),'match');assert.equal(colorAgreement('dark brown','brown'),'conflict');assert.equal(colorAgreement(null,'brown'),'unknown');
});
test('E: missing results, malformed/absent product photos, allowSimilar false and failed images return not_found without invented media',async()=>{
 for(const p of [product({image:[]}),{'@type':'WebPage'},product({image:'javascript:alert(1)'})]) {
  const {service}=await fixture(p);const r=await service.find(item(),{sourceUrls:[page],allowSimilar:false});assert.equal(r.identificationStatus,'not_found');assert.deepEqual(r.referenceImages,[]);assert.equal(r.vintedImages[0].imageUrl,listingPhoto);
 }
 const {service}=await fixture(product(),{failImages:true});const r=await service.find(item(),{sourceUrls:[page]});assert.equal(r.identificationStatus,'not_found');assert.ok(r.errors.some(e=>e.stage==='image'));
});
test('F: 403 stops, cooldown suppresses subsequent requests; browser fallback is probable and never exact',async()=>{
 const {service,calls}=await fixture(product(),{fail:'External source HTTP 403'});
 const a=await service.find(item(),{sourceUrls:[page],labelEvidence:label});assert.equal(a.identificationStatus,'not_found');
 const b=await service.find(item(),{sourceUrls:[page],webEvidence:[observations()],labelEvidence:label});
 assert.equal(calls.filter(c=>c.url===page).length,1);assert.equal(b.identificationStatus,'probable_same_product');assert.equal(b.referenceImages[0].verificationEvidence.imageAssociation,'caller_reported_page_image_unverified');assert.ok(b.errors.some(e=>/cooldown/.test(e.error)));
});
test('exact identity requires the code actually observed on the listing label, not another matching seller claim',async()=>{
 const {service}=await fixture();const r=await service.find(item(),{sourceUrls:[page],labelEvidence:{...label,observedCode:'OTHER12345'}});assert.equal(r.identificationStatus,'probable_same_product');
 await assert.rejects(()=>service.find(item(),{labelEvidence:{...label,photoUrl:'https://media.cos.com/label.webp'}}),/actual listing photo/);
 const p={brand:'COS',color:null,source:{tier:'A'},identifiers:[{value:'1234567890'}],evidenceMethod:'server_fetched_jsonld'};assert.equal(classifyReference(item(),p,label).status,'probable_same_product');
 assert.equal(classifyReference(item(),{...p,color:'Brown',source:{tier:'C'}},label).status,'probable_same_product');
});
test('model evidence needs multiple consistent clues and normalizes punctuation in brand names',()=>{
 const p={brand:'Levi’s',model:'568 Stay Loose',color:'Blue',material:'Cotton',identifiers:[],source:{tier:'B'},evidenceMethod:'server_fetched_jsonld'};
 assert.equal(classifyReference(item({brand:"Levi's",model:'568 Stay Loose',color:'blauw',materials:['Cotton']}),p).status,'probable_same_product');
 assert.equal(classifyReference(item({brand:"Levi's",model:'568 Stay Loose',color:'blauw',materials:[]}),p).status,'similar_reference');
});
test('source priority and model views rank deterministically, deduplicating shared media and page loads',async()=>{
 const shared='https://media.cos.com/detail.webp';const {service,calls}=await fixture(product({image:[{url:shared,caption:'Product-only packshot'},{url:image,caption:'Worn by model front'},{url:image,caption:'Worn by model front'}]}));
 const r=await service.find(item(),{sourceUrls:[page,page],maxImages:1});assert.equal(r.referenceImages[0].imageUrl,image);assert.equal(calls.filter(c=>c.url===page).length,1);
 const b=await service.find(item(),{sourceUrls:[page],preferOnModel:false,maxImages:8});assert.equal(b.referenceImages.length,2);assert.equal(calls.filter(c=>c.url===image).length,1);
 assert.equal(sourceInfo(page).tier,'A');assert.equal(sourceInfo('https://www.grailed.com/listings/123').tier,'C');
 for(const u of ['https://cos.com.evil.net/product','https://unknown.example/product','https://127.0.0.1/product']) assert.throws(()=>sourceInfo(u));
});
test('JSON-LD image association excludes recommendations, unrelated URLs and all ambiguous multi-product pages',()=>{
 assert.equal(jsonLdAdapter.parse(html({'@type':'ItemList',itemListElement:[product(),product({sku:'another'})]}),page).length,0);
 assert.equal(jsonLdAdapter.parse(html(product({url:'https://www.cos.com/other-product'})),page).length,0);
 assert.equal(jsonLdAdapter.parse(html(product({url:page})),page).length,1);
 const p=product({image:[{url:image,caption:'Detail'}]});assert.equal(jsonLdAdapter.parse(html(p),page)[0].photos[0].caption,'Detail');
});
test('caller images cannot inject unrelated media into a fetched Product node',async()=>{
 const {service}=await fixture();const obs=observations('https://evil.example/not-product.jpg');
 const r=await service.find(item(),{sourceUrls:[page],webEvidence:[obs]});assert.equal(r.referenceImages[0].imageUrl,image);assert.equal(r.referenceImages[0].verificationEvidence.onModelEvidence.method,'source_image_caption_unverified_visually');
});
test('on-model recognition uses explicit observations/captions only, never filenames or guesses',()=>{
 assert.deepEqual(imageObservation({url:'https://media.cos.com/model-front.webp'}).onModel,null);
 assert.equal(imageObservation({caption:'Worn by model side view'}).imageType,'model_side');assert.equal(imageObservation({caption:'Worn by model back'}).imageType,'model_back');
 assert.equal(imageObservation({caption:'Product-only packshot'}).onModel,false);
 assert.throws(()=>imageObservation({}, {observer:'chatgpt_vision',imageType:'model_front',onModel:false,observation:'x'}));
});
test('fit comparison rejects wrong listing/photo, missing criteria, conflicting shape and duplicate features; differences remain explicit',()=>{
 const evidence=observations();assert.ok(fitComparison(item(),evidence,image));
 for(const change of [{listingPhotoUrl:'https://media.cos.com/other.webp'},{referenceImageUrl:'https://media.cos.com/other.webp'},{features:evidence.comparison.features.slice(0,3)},
  {features:evidence.comparison.features.map(f=>({...f,status:f.feature==='fit'?'mismatch':f.status}))}]) assert.equal(fitComparison(item(),{comparison:{...evidence.comparison,...change}},image),null);
 evidence.comparison.features.push({feature:'details',status:'mismatch',explanation:'Reference has a smaller cuff'});assert.equal(fitComparison(item(),evidence,image).differences.length,1);
 evidence.comparison.features.push(evidence.comparison.features[0]);assert.equal(fitComparison(item(),evidence,image),null);
});
test('SSRF policy rejects credentials, ports, numeric/IPv6 hosts, local DNS and non-HTTPS; global IPv4 answers only',async()=>{
 for(const u of ['file:///etc/passwd','http://cos.com/x','https://user:pass@cos.com/x','https://cos.com:444/x','https://2130706433/x','https://[::1]/x','https://localhost/x','https://test.local/x']) assert.throws(()=>publicHttps(u));
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.1.2','192.168.1.2','100.64.1.2','0.0.0.0','224.1.1.1','::ffff:127.0.0.1','::1','198.18.0.1']) assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('93.184.216.34'),true);
 await assert.rejects(()=>pinnedHttps('https://localhost/x',100),/Public HTTPS/);
});
test('HTTP MIME, oversize, redirects, timeouts and rate limits fail without retries; failed loads are not cached',async()=>{
 for(const scenario of ['External source HTTP 302','External source timed out (10s)']) {
  let calls=0;const http=new ReferenceHttp(async()=>{calls++;throw Error(scenario)});
  await assert.rejects(()=>http.get(page,'page'));await assert.rejects(()=>http.get(page,'page'));assert.equal(calls,2);
 }
 let calls=0;const limited=new ReferenceHttp(async()=>{calls++;throw Error('External source HTTP 429')});await assert.rejects(()=>limited.get(page,'page'),/429/);await assert.rejects(()=>limited.get(page,'page'),/cooldown/);assert.equal(calls,1);
 await assert.rejects(()=>new ReferenceHttp(async()=>body('x','application/pdf')).get(page,'page'),/MIME/);
 await assert.rejects(()=>new ReferenceHttp(async()=>body(new Uint8Array(2000001))).get(page,'page'),/byte limit/);
});
test('reference images are decoded and MIME/format/size checked; pending loads and cache retain original timestamps',async()=>{
 const {service,calls,bytes}=await fixture();const [a,b]=await Promise.all([service.loadImage(image),service.loadImage(image)]);assert.deepEqual(a,b);assert.equal(calls.length,1);assert.equal(a.fetchedAt,'2026-11-10T10:00:00Z');assert.equal((await sharp(Buffer.from(a.data,'base64')).metadata()).format,'jpeg');
 for(const result of [body(bytes,'image/png'),body('not an image','image/webp'),body('x','text/html')]) {
  const invalid=new ReferenceService(new ReferenceHttp(async()=>result));await assert.rejects(()=>invalid.loadImage(image));
 }
});
test('bounded provider makes multiple real-result searches and separately attempts similar search, with query handoff when unavailable',async()=>{
 const queries=[];const provider={name:'fixture_search',available:true,search:async p=>{queries.push(p);return [page,'https://127.0.0.1/not-safe','https://unknown.example/product'];}};
 const {service}=await fixture(product(),{provider});const r=await service.find(item());assert.equal(r.identificationStatus,'probable_same_product');assert.equal(queries.length,4);assert.ok(queries.some(q=>q.purpose==='similar'));assert.ok(r.search.queries.some(q=>q.query.includes('1234567890')));
 const no=await (await fixture()).service.find(item());assert.equal(no.search.automatedSearchAvailable,false);assert.ok(no.search.queries.length>=5);assert.equal(no.identificationStatus,'not_found');
});
test('Brave uses documented endpoint/header and real result URLs, without requiring credentials by default',async()=>{
 let seen;const http=new ReferenceHttp(async(url,max,headers)=>{seen={url,headers};return body(JSON.stringify({web:{results:[{url:page}]}}),'application/json')});
 const provider=new BraveSearchProvider('fixture-secret',http);assert.deepEqual(await provider.search({query:'COS SKU12345',purpose:'identity',tier:'A'}),[page]);assert.ok(seen.url.startsWith('https://api.search.brave.com/res/v1/web/search?'));assert.equal(seen.headers['X-Subscription-Token'],'fixture-secret');
 assert.equal(new BraveSearchProvider(undefined,http).available,false);
});
test('MCP schema accepts required defaults/observations and rejects malformed evidence, excessive limits and missing listing identity',()=>{
 const ajv=new Ajv({strict:false});const validate=ajv.compile(findProductReferenceImagesTool.inputSchema);
 assert.ok(validate({itemId:42}));assert.ok(validate({url:item().url,webEvidence:[observations()]}));
 for(const args of [{},{itemId:0},{itemId:42,maxImages:99},{itemId:42,allowSimilar:'false'},{itemId:42,webEvidence:[{sourceUrl:page}]},{itemId:42,sourceUrls:Array(7).fill(page)},{itemId:42,extra:'x'}]) assert.equal(validate(args),false);
});
test('G local protocol: listing/reference bytes remain separately addressable with structured status and per-image provenance',async()=>{
 const {service,bytes}=await fixture();const imageLoader={load:async()=>({data:bytes.toString('base64'),bytes:bytes.length,mimeType:'image/webp',width:200,height:400})};
 const server=createServer({client:{getItem:async()=>item()},referenceService:service,imageLoader});const client=new Client({name:'reference-protocol',version:'1'},{capabilities:{}});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const tools=await client.listTools();assert.equal(tools.tools.length,12);assert.ok(tools.tools.find(t=>t.name==='find_product_reference_images').annotations.readOnlyHint);
  const response=await client.callTool({name:'find_product_reference_images',arguments:{itemId:42,country:'nl',sourceUrls:[page],labelEvidence:label}});
  assert.ok(!response.isError);const data=response.structuredContent;assert.equal(data.identificationStatus,'exact_verified');assert.equal(data.vintedImages[0].contentIndex,1);assert.equal(data.referenceImages[0].contentIndex,2);assert.equal(response.content[1].type,'image');assert.equal(response.content[2].type,'image');assert.notEqual(response.content[1].data,response.content[2].data);
  for(const block of response.content.slice(1)) assert.ok((await sharp(Buffer.from(block.data,'base64')).metadata()).width>0);
  const invalid=await client.callTool({name:'find_product_reference_images',arguments:{itemId:42,maxImages:999}});assert.equal(invalid.isError,true);
 }finally{await client.close();await server.close();}
});
test('lazy integration enriches only explicitly selected candidates, is opt-in and bounded',async()=>{
 const candidates=Array.from({length:100},(_,i)=>item({id:i+1}));let calls=0;const client={getItem:async id=>{calls++;return item({id});}};const service={find:async()=>({referenceImages:[],identificationStatus:'not_found'})};
 await enrichSelectedReferences(client,candidates,{},service);assert.equal(calls,0);
 await enrichSelectedReferences(client,candidates,{includeReferenceImages:true,referenceLimit:2,referenceRequests:[{itemId:7},{itemId:8},{itemId:9}],country:'nl'},service);assert.equal(calls,2);assert.ok(candidates[6].referenceImages);assert.equal(candidates[8].referenceImages,undefined);
});
test('find_original_product preserves legacy source-free status and adds richer queries and lazy reference arguments',async()=>{
 const r=JSON.parse(await handleFindOriginalProduct({getItem:async()=>item()},{itemId:42,country:'nl'}));assert.equal(r.status,'not_identified');assert.equal(r.identificationStatus,'not_found');assert.ok(r.searchQueries.some(q=>q.includes('1234567890')));assert.equal(r.referenceImageToolArguments.itemId,42);assert.ok(Array.isArray(r.candidates));
});


test('Shopify adapter binds galleries to the same handle/brand/code and rejects multi-color galleries or wrong handles',async()=>{
 const source='https://www.timberland.co.nz/products/test-boot';
 const p={handle:'test-boot',vendor:'Timberland',title:'Boot',variants:[{sku:'CODE12345'}],options:[{name:'Colour',values:['Wheat']}],media:[{media_type:'image',src:image,alt:'Worn by model side'}]};
 const parsed=parseShopifyProduct(p,source);assert.equal(parsed.color,'Wheat');assert.equal(parsed.photos[0].url,image);
 assert.equal(parseShopifyProduct({...p,handle:'wrong'},source),null);
 assert.equal(parseShopifyProduct({...p,options:[{name:'Color',values:['Wheat','Black']}]},source),null);
 const http=new ReferenceHttp(async url=>url.endsWith('.js')?body(JSON.stringify(p),'text/javascript'):body(html(product({brand:'Timberland',sku:'CODE12345',name:'Boot',color:'Wheat'}))+'<script>Shopify.theme = {}</script>'));
 const products=await loadProductPage(source,http);assert.equal(products[0].mediaEvidenceMethod,'same_handle_shopify_product_api');assert.equal(products[0].photos[0].caption,'Worn by model side');
});
test('ProductGroup inherits explicit brand/source URL while preserving individual variant code and color',()=>{
 const grouped={'@type':'ProductGroup',url:page,brand:{name:'COS'},hasVariant:[product({brand:undefined,color:'Brown'}),product({brand:undefined,color:'Blue'})]};
 const products=jsonLdAdapter.parse(html(grouped),page);assert.equal(products.length,2);assert.equal(products[0].brand,'COS');assert.equal(products[1].color,'Blue');
 const without=product();delete without.image;assert.deepEqual(jsonLdAdapter.parse(html(without),page)[0].photos,[]);
});
test('observed wrong image variant and declared synthetic imagery are excluded even when page identifiers agree',async()=>{
 for(const change of [{color:'Blue'},{productCode:'WRONG12345'},{observation:'AI-generated image showing model'}]){
  const {service}=await fixture();const e=observations();Object.assign(e.images[0],change);
  const r=await service.find(item(),{sourceUrls:[page],labelEvidence:label,webEvidence:[e]});assert.equal(r.identificationStatus,'not_found');
 }
});

test('reference content deduplication retains alternative verified source attribution',async()=>{
 const bytes=await png(),other='https://www.zalando.nl/same-cos-sweater.html',otherImage='https://img.zalando.nl/same-picture.webp';
 const http=new ReferenceHttp(async(url)=>url===page?body(html(product())):url===other?body(html(product({image:otherImage}))):body(bytes,'image/webp'));
 const service=new ReferenceService(http);const r=await service.find(item(),{sourceUrls:[other,page],labelEvidence:label});
 assert.equal(r.referenceImages.length,1);assert.equal(r.referenceImages[0].sourceTier,'A');assert.equal(r.referenceImages[0].alsoFoundAt[0].sourcePageUrl,other);
});
test('pinned network rejects local DNS answers before opening a socket and retains the checked address for lookup',async()=>{
 const dns=require('node:dns').promises,https=require('node:https'),{EventEmitter}=require('node:events');
 const lookup=dns.lookup,get=https.get;let socketCalls=0;
 try{
  dns.lookup=async()=>[{address:'127.0.0.1',family:4}];https.get=()=>{socketCalls++;throw Error('should not connect');};
  await assert.rejects(()=>pinnedHttps(page,100,{Accept:'text/html'}),/Unsafe DNS/);assert.equal(socketCalls,0);
  dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  https.get=(url,options,callback)=>{
   socketCalls++;options.lookup('cos.com',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
   options.lookup('cos.com',{all:true},(error,addresses)=>assert.equal(addresses[0].address,'93.184.216.34'));
   const req=new EventEmitter();req.destroy=()=>{};
   process.nextTick(()=>{const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'text/html'};response.destroy=()=>{};callback(response);response.emit('data',Buffer.from('ok'));response.emit('end');});return req;
  };
  const result=await pinnedHttps(page,100,{Accept:'text/html'});assert.equal(Buffer.from(result.bytes).toString(),'ok');assert.equal(socketCalls,1);
 }finally{dns.lookup=lookup;https.get=get;}
});
test('public gallery API is never used to bypass a blocked page and official brand contradictions fail closed',async()=>{
 let calls=0;const source='https://www.timberland.co.nz/products/test-boot';
 const blocked=new ReferenceHttp(async()=>{calls++;throw Error('External source HTTP 403');});
 await assert.rejects(()=>loadProductPage(source,blocked),/403/);assert.equal(calls,1);
 await assert.rejects(()=>loadProductPage(page,new ReferenceHttp(async()=>body(html(product({brand:'Other brand'}))))),/brand contradicts/);
});

test('profile uses explicit model/collection/material/construction fields before search without inventing a model from title',()=>{
 const {productProfile}=require('../dist-ts/visual/product-profile');
 const raw=item({title:'Sweater branded popular model',description:'Model name: Special Knit\nCollection: AW2021\nMaterial: wool\nConstruction: ribbed crew neck'});
 const p=productProfile(raw);assert.equal(p.model,'Special Knit');assert.equal(p.collection,'AW2021');assert.equal(p.material,'wool');assert.equal(p.construction,'ribbed crew neck');
 assert.ok(referenceQueries(raw).some(q=>q.query.includes('Special Knit')));assert.ok(referenceQueries(raw).some(q=>q.query.includes('AW2021')&&q.query.includes('wool')));
 assert.equal(productProfile(item({title:'Brown casual sweater'})).model,null);
});
test('actual transport deadline covers a stalled body and destroys its socket',async()=>{
 const dns=require('node:dns').promises,https=require('node:https'),{EventEmitter}=require('node:events');
 const lookup=dns.lookup,get=https.get,timer=global.setTimeout;let destroyed=false,deadline;
 try{
  dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  global.setTimeout=(callback,ms,...args)=>{deadline=ms;return timer(callback,5,...args);};
  https.get=(url,options,callback)=>{const req=new EventEmitter();req.destroy=()=>{destroyed=true;};process.nextTick(()=>{const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'text/html'};response.destroy=()=>{};callback(response);response.emit('data',Buffer.from('stalled body'));});return req;};
  await assert.rejects(()=>pinnedHttps(page,100,{Accept:'text/html'}),/timed out/);assert.equal(deadline,10000);assert.equal(destroyed,true);
 }finally{dns.lookup=lookup;https.get=get;global.setTimeout=timer;}
});
test('on-model preference can select a retailer model image; disabling it preserves official-source priority',async()=>{
 const other='https://www.zalando.nl/cos-model.html';const model='https://img.zalando.nl/cos-model.webp';
 const first=await png(),second=await sharp({create:{width:100,height:200,channels:3,background:'#886644'}}).webp().toBuffer();
 const service=new ReferenceService(new ReferenceHttp(async url=>url===page?body(html(product({image:[{url:image,caption:'Product-only packshot'}]}))):url===other?body(html(product({image:[{url:model,caption:'Worn by model front'}]}))):body(url===image?first:second,'image/webp')));
 const r=await service.find(item(),{sourceUrls:[other,page],labelEvidence:label,maxImages:1});assert.equal(r.referenceImages[0].sourceTier,'B');
 const s=await service.find(item(),{sourceUrls:[other,page],labelEvidence:label,maxImages:1,preferOnModel:false});assert.equal(s.referenceImages[0].sourceTier,'A');
});

test('a product code mentioned only in source prose cannot establish exact identity',async()=>{
 const {service}=await fixture(product({sku:undefined,description:'Pairs with SKU: 1234567890'}));
 const r=await service.find(item(),{sourceUrls:[page],labelEvidence:label});assert.equal(r.identificationStatus,'probable_same_product');
});

test('many identity results cannot starve archive search or reserved fit-reference fetches',async()=>{
 const calls=[],pages=[];
 const provider={name:'many_results',available:true,search:async plan=>{calls.push(plan);return plan.purpose==='similar'?[page]:Array.from({length:5},(_,i)=>`https://www.cos.com/identity-${plan.tier}-${i}`);}};
 const service=new ReferenceService(new ReferenceHttp(async url=>{pages.push(url);return body(html(product({sku:'OTHER12345'})));}),provider);
 const result=await service.find(item(),{allowSimilar:true});assert.equal(calls.length,4);assert.ok(calls.some(p=>p.tier==='C'));assert.ok(calls.some(p=>p.purpose==='similar'));assert.ok(pages.includes(page));assert.ok(pages.length<=6);assert.equal(result.identificationStatus,'not_found');
});
