import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInteraction} from '../src/bot.js';
import {followLink} from '../src/link.js';
import {COMMANDS} from '../src/commands.js';
const token='a'.repeat(64),url='https://openrotmg.org/link/#'+token;
function interaction(commandName='link') {
  return {guildId:'guild',user:{id:'12345678901234567'},commandName,isChatInputCommand:()=>true,edits:[],options:{getString:()=>{throw Error('No code/password/target option should be read')}},
    async deferReply(payload){assert.deepEqual(payload,{flags:64});this.deferred=true},
    async editReply(payload){assert.equal(this.deferred,true);this.edits.push(payload);this.payload=payload}};
}
test('/link replaces its private button with committed success, never a new message',async()=>{
  const i=interaction();
  await handleInteraction(i,{guildId:'guild',linkGame:async(id)=>{assert.equal(id,i.user.id);return {url}},linkStatus:async value=>{assert.equal(value,token);return {state:'linked'}}});
  assert.equal(i.edits[0].components[0].components[0].url,url);
  assert.equal(i.edits[0].components[0].components[0].label,'Link game account');
  assert.equal(i.edits[1].content,'Account linked!');assert.deepEqual(i.edits[1].components,[]);
  assert.equal(COMMANDS.find(c=>c.name==='link').options,undefined);
});
test('/link expires honestly and rejects malformed or offsite grants and status failures',async()=>{
  for(const bad of ['https://evil.example/link/#'+token,'https://openrotmg.org/link/?token=secret#'+token,'https://openrotmg.org/link/#bad']){
    const i=interaction();await handleInteraction(i,{guildId:'guild',linkGame:async()=>({url:bad}),linkStatus:async()=>assert.fail('Do not poll an untrusted grant')});
    assert.match(i.payload.content,/could not be confirmed/);assert.deepEqual(i.payload.components,[]);
  }
  const i=interaction();await handleInteraction(i,{guildId:'guild',linkGame:async()=>({url}),linkStatus:async()=>({state:'expired'})});
  assert.equal(i.payload.content,'Link expired. Run /link again.');assert.deepEqual(i.payload.components,[]);
  await handleInteraction(i,{guildId:'guild',linkGame:async()=>({url}),linkStatus:async()=>{throw Error('Link service unavailable')}});
  assert.match(i.payload.content,/could not be confirmed: Link service unavailable/);assert.deepEqual(i.payload.components,[]);
});
test('pending link checks are bounded and cannot report success from a claim or unknown state',async()=>{
  const i=interaction();await i.deferReply({flags:64});let time=0,polls=0;
  await followLink(i,token,async()=>{polls++;return {state:'pending'}},{now:()=>time,wait:async ms=>{time+=ms}});
  assert.equal(time,300000);assert.equal(polls,60);assert.equal(i.payload.content,'Link expired. Run /link again.');
  await assert.rejects(followLink(i,token,async()=>({state:'claimed'})),/Invalid link status/);
  let state=0;
  await followLink(i,token,async()=>({state:state++?'linked':'pending'}),{wait:async()=>{}});
  assert.equal(i.payload.content,'Account linked!');
});
test('/unlink is caller-only and private, revokes recovery, and reports absent links or failures honestly',async()=>{
  const i=interaction('unlink');const context={guildId:'guild',unlinkGame:async id=>{assert.equal(id,i.user.id);return {unlinked:true}}};
  await handleInteraction(i,context);assert.match(i.payload.content,/Account unlinked.*recovery is disabled.*revoked/);assert.match(i.payload.content,/password has not changed/);
  await handleInteraction(i,{...context,unlinkGame:async()=>({unlinked:false})});assert.match(i.payload.content,/No game account is linked/);
  await handleInteraction(i,{...context,unlinkGame:async()=>({})});assert.match(i.payload.content,/Unlink could not be confirmed/);
  assert.equal(COMMANDS.find(c=>c.name==='unlink').options,undefined);
});
