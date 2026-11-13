import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/videos.html',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../node-functions/lib/api-core.js',import.meta.url),'utf8');
const fn=html.slice(html.indexOf('function youtubeId(value){'),html.indexOf('\nfunction updateUrl(){'));
const ctx={URL,location:{href:'https://eduspace.example/videos.html'}};
vm.runInNewContext(`${fn}\nthis.youtubeId=youtubeId;this.thumbnailSources=thumbnailSources;`,ctx);

test('recognises valid YouTube video shares and never produces an image for an unrelated URL',()=>{
  const id='dQw4w9WgXcQ';
  for(const share of [
    `https://www.youtube.com/watch?v=${id}&t=2s`,
    `https://youtube.com/watch?si=secret&v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://m.youtube.com/shorts/${id}?feature=share`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?v=${id}&amp;si=abc`
  ]) assert.equal(ctx.youtubeId(share),id,share);
  for(const share of [
    `https://notyoutube.com/watch?v=${id}`,
    'https://youtube.com/channel/UCsomething',
    'https://youtube.com/watch?v=too-short',
    'javascript:alert(1)'
  ]) assert.equal(ctx.youtubeId(share),'',share);
});

test('thumbnail sources are genuine YouTube image URLs with same-site recovery',()=>{
  const id='dQw4w9WgXcQ';
  const sources=Array.from(ctx.thumbnailSources(id));
  assert.equal(sources.length,4);
  assert.equal(sources[0],`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(sources.at(-1),`/api/video-thumbnail/${id}`);
  assert.match(html,/addEventListener\("error",event=>/);
  assert.match(html,/addEventListener\("load",event=>/);
  assert.match(html,/Video thumbnail could not load\. Tap to watch on YouTube\./);
  assert.doesNotMatch(html,/subject-cover\/general|eduspace-crown|assets\/battle\/crown/);
});

test('thumbnail proxy has a fixed YouTube host and does not fetch the student database',()=>{
  const proxy=core.slice(core.indexOf('    // Thumbnail CDN fallback:'),core.indexOf('    let bootstrapData = null;'));
  assert.match(proxy,/^    if \(m === "GET" && \/\^/m);
  assert.match(proxy,/https:\/\/i\.ytimg\.com\/vi\/\$\{videoId\}\/hqdefault\.jpg/);
  assert.match(proxy,/max-age=86400/);
  assert.doesNotMatch(proxy,/load\(\)|await auth|store\(\)/);
});

test('thumbnail proxy serves a valid image response and refuses invalid upstream content',async()=>{
  const {default:handler}=await import('../node-functions/lib/api-core.js');
  const realFetch=global.fetch;
  try{
    let called='';
    global.fetch=async url=>{
      called=String(url);
      return new Response(new Uint8Array(240),{status:200,headers:{'content-type':'image/jpeg','content-length':'240'}});
    };
    const result=await handler(new Request('https://eduspace.test/api/video-thumbnail/dQw4w9WgXcQ'));
    assert.equal(result.status,200);
    assert.equal(called,'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.equal(result.headers.get('content-type'),'image/jpeg');
    assert.match(result.headers.get('cache-control'),/public/);
    global.fetch=async()=>new Response('Bad gateway',{status:200,headers:{'content-type':'text/html'}});
    const failed=await handler(new Request('https://eduspace.test/api/video-thumbnail/dQw4w9WgXcQ'));
    assert.equal(failed.status,502);
  }finally{global.fetch=realFetch;}
});
