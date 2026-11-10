#!/usr/bin/env node
// Explicit read-only live probe. Run in an isolated built checkout, never the active runtime.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
if(!args.includes('--live')||!option('--url')){
 console.error('Explicit opt-in: node scripts/verify-reference-live.cjs --live --url REAL_VINTED_URL [--source REAL_PRODUCT_PAGE] [--evidence FILE]');process.exit(2);
}
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'vinted-reference-live-'));
 const env={...process.env,VINTED_MCP_TRANSPORT:'stdio',VINTED_AUTH_MODE:'http',VINTED_PROFILE_DIR:path.join(out,'anonymous-profile'),VINTED_REQUEST_DELAY_MS:'1000',VINTED_MAX_CONCURRENCY:'1',VINTED_MAX_RETRIES:'0',VINTED_REFERENCE_SEARCH:'handoff'};
 delete env.VINTED_AUTH_COOKIES;delete env.VINTED_PROXY_URL;
 const client=new Client({name:'reference-live-check',version:'1.0'},{capabilities:{}});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/bundle.js')],env,cwd:process.cwd()});
 try{
  await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,12);
  const input={url:option('--url'),includeContent:true};if(option('--source')) input.sourceUrls=[option('--source')];
  if(option('--evidence')) Object.assign(input,JSON.parse(fs.readFileSync(option('--evidence'),'utf8')));
  const result=await client.callTool({name:'find_product_reference_images',arguments:input},undefined,{timeout:180000});
  if(result.isError)throw Error(result.content[0]?.text||'MCP error');
  const data=result.structuredContent;assert.ok(data);assert.equal(data.listingUrl.includes('/items/'),true);
  const images=[];for(let i=0;i<result.content.length;i++)if(result.content[i].type==='image'){
   const block=result.content[i],bytes=Buffer.from(block.data,'base64');const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'jpeg');
   fs.writeFileSync(path.join(out,`content-${i}.jpg`),bytes);images.push({contentIndex:i,bytes:bytes.length,width:metadata.width,height:metadata.height});
  }
  assert.ok(data.vintedImages[0]?.contentIncluded,'Actual listing image should be returned');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({input,data,images,chatgptAcceptance:'not_tested_by_local_stdio_probe'},null,2));
  console.log(JSON.stringify({outputDirectory:out,itemId:data.itemId,identificationStatus:data.identificationStatus,referenceImages:data.referenceImages.map(i=>({imageUrl:i.imageUrl,sourcePageUrl:i.sourcePageUrl,matchType:i.matchType,onModel:i.onModel})),images,errors:data.errors,chatgptAcceptance:'pending_connector_activation'},null,2));
 }finally{await client.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
