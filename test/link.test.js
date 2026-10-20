import test from 'node:test';
import assert from 'node:assert/strict';
import {handleInteraction} from '../src/bot.js';
import {COMMANDS} from '../src/commands.js';

function interaction() {
  return {guildId:'guild',user:{id:'12345678901234567'},commandName:'link',isChatInputCommand:()=>true,options:{getString:()=>{throw Error('No code/password option should be read')}},
    async deferReply(payload){assert.deepEqual(payload,{flags:64});this.deferred=true},
    async reply(payload){this.payload=payload},async editReply(payload){assert.equal(this.deferred,true);this.payload=payload}};
}
test('/link privately returns a browser button bound to the real caller without a copied code',async()=>{
  const i=interaction();let called=false;
  await handleInteraction(i,{guildId:'guild',linkGame:async(id)=>{assert.equal(id,i.user.id);called=true;return {url:'https://openrotmg.org/link/#'+'a'.repeat(64)}}});
  assert.equal(called,true);assert.equal(i.payload.components[0].components[0].url,'https://openrotmg.org/link/#'+'a'.repeat(64));
  assert.equal(i.payload.components[0].components[0].label,'Link game account');
  assert.ok(!i.payload.content.includes('password'));assert.equal(COMMANDS.find(c=>c.name==='link').options,undefined);
});
test('/link rejects offsite or malformed grants and reports the failure privately',async()=>{
  for(const url of ['https://evil.example/link/#'+'a'.repeat(64),'https://openrotmg.org/link/?token=secret#'+'a'.repeat(64),'https://openrotmg.org/link/#bad']){
    const i=interaction();await handleInteraction(i,{guildId:'guild',linkGame:async()=>({url})});
    assert.match(i.payload.content,/could not/);assert.equal(i.payload.components,undefined);
  }
});
