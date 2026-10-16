import test from 'node:test';
import assert from 'node:assert/strict';
import {plainText, syncUpdates} from '../src/updates.js';

const guildId='12345678901234567', channelId='23456789012345678';
const message = (id='34567890123456789') => ({id,channel_id:channelId,type:0,content:'# **A new update**\n\nHeal & play together.',timestamp:'2026-10-16T08:00:00.500Z',edited_timestamp:null,attachments:[],embeds:[]});
function fixture(messages) {
  const logs=[],published=[];
  const options={guildId,channelId,log:(...row)=>logs.push(row),rest:{get:async(route,{query})=>{
    assert.equal(route,`/channels/${channelId}/messages`);assert.equal(query.get('limit'),'100');return structuredClone(messages);
  }},publish:async body=>{published.push(body);return {synced_at:1792137600,source:body};}};
  return {options,published,logs};
}
test('startup snapshot, edits, deletions and empty channels reconcile by message ID',async()=>{
  const messages=[message('34567890123456790'),message()];const {options,published,logs}=fixture(messages);
  await syncUpdates(options);
  assert.deepEqual(published[0],{guild_id:guildId,channel_id:channelId,posts:messages.map(m=>({id:m.id,content:'A new update\n\nHeal & play together.',published_at:1792137600,edited_at:null}))});
  messages[0].content='Edited headline';messages[0].edited_timestamp='2026-10-16T08:01:00.000Z';messages.pop();
  await syncUpdates(options);assert.equal(published[1].posts.length,1);assert.equal(published[1].posts[0].edited_at,1792137660);
  messages.length=0;await syncUpdates(options);assert.deepEqual(published[2].posts,[]);
  assert.equal(logs[2][0],'updates_synced');assert.equal(logs[2][1].posts,0);
});
test('safe plain text preserves paragraphs, links, literal HTML and attachment provenance',async()=>{
  assert.equal(plainText('## Title\r\n\r\n**bold** and *italic* `code`\n[Site](https://example.org) <:amulet:123>'), 'Title\n\nbold and italic code\nSite (https://example.org) :amulet:');
  assert.equal(plainText('Title\n\n## Section\n\nBody'), 'Title\n\nSection\n\nBody');
  const m=message();m.content='<script>alert(1)</script>\n\nSecond paragraph';m.attachments=[{filename:'demo.png'}];
  const {options,published}=fixture([m]);await syncUpdates(options);
  assert.equal(published[0].posts[0].content,'<script>alert(1)</script>\n\nSecond paragraph\n\nAttachments on Discord: demo.png');
  m.content='';const f=fixture([m]);await syncUpdates(f.options);assert.match(f.published[0].posts[0].content,/Attachments on Discord: demo.png/);
});
test('bad pages/messages never publish a partial snapshot',async()=>{
  for(const bad of [null,{},Array(101).fill(message()),[message(),message()],
    [{...message(),channel_id:guildId}],[{...message(),content:'a\0b'}],[{...message(),content:'a\uffffb'}],[{...message(),timestamp:'bad'}],
    [{...message(),edited_timestamp:'2020-01-01'}],[{...message(),content:'x'.repeat(8001)}],
    [{...message(),content:'',embeds:[{title:'An embed'}]}]]) {
    const f=fixture(bad);await assert.rejects(syncUpdates(f.options),/Invalid|only embeds/);assert.equal(f.published.length,0);
  }
});
test('system messages are skipped explicitly; Discord and game failures propagate for retry',async()=>{
  const f=fixture([{...message(),type:6}]);await syncUpdates(f.options);assert.equal(f.logs[0][1].skipped,1);
  f.options.rest.get=async()=>{throw Error('Discord unavailable');};await assert.rejects(syncUpdates(f.options),/Discord unavailable/);
  const g=fixture([message()]);g.options.publish=async()=>{throw Error('game unavailable');};await assert.rejects(syncUpdates(g.options),/game unavailable/);
  g.options.publish=async()=>({synced_at:1,source:{guild_id:guildId,channel_id:channelId,posts:[]}});
  await assert.rejects(syncUpdates(g.options),/Invalid update sync receipt/);
});
