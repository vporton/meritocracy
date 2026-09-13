#!/usr/bin/env node
// Synthetic workflow/authority proof only: no DFX, identity, wallet, network,
// workflow payload, provider response, target data, or deployment.
const path = require("node:path"), fs = require("node:fs"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "../../node_modules/ic-mops/node_modules");
const { PocketIc, PocketIcServer } = require(path.join(root, "pic-js-mops"));
const { IDL } = require(path.join(root, "@icp-sdk/core/lib/cjs/candid/index.js"));
const { Principal } = require(path.join(root, "@icp-sdk/core/lib/cjs/principal/index.js"));
const [bin, authorityWasm, workflowWasm] = process.argv.slice(2);
if (!bin || !authorityWasm || !workflowWasm) throw new Error("Expected PocketIC binary, authority Wasm, and workflow Wasm");
const Hash = IDL.Vec(IDL.Nat8), P = IDL.Principal;
const Config = IDL.Record({ core:P, workflow:P, treasury:P, archive:P, evidence:P, governance:P });
const Input = IDL.Record({ logicalId:IDL.Text, cycleId:IDL.Text, operationName:IDL.Text, desiredVersion:IDL.Nat64, contentHash:Hash });
const Write = IDL.Variant({ acknowledged:IDL.Null, blocked:IDL.Null, conflict:IDL.Null, storageError:IDL.Null });
const Observation = IDL.Variant({ absent:IDL.Null, present:IDL.Record({version:IDL.Nat64, contentHash:Hash}), conflict:IDL.Null, storageError:IDL.Null });
const Recovery = IDL.Variant({ acknowledge:IDL.Null, retryIdentical:IDL.Null, conflict:IDL.Null, blocked:IDL.Null });
const authorityIdl = ({IDL:C}) => C.Service({ writeWorkflowCompletionReceipt:C.Func([Input],[Write],[]), lookupWorkflowCompletionReceipt:C.Func([C.Text],[Observation],[]) });
const workflowIdl = ({IDL:C}) => C.Service({ writeThenLoseReply:C.Func([Input],[],[]), journalThenTrapBeforeAwait:C.Func([Input],[],[]), reconcileLostReply:C.Func([],[Recovery],[]), retryJournaledWriteThenLoseReply:C.Func([],[],[]), repairJournaledReceipt:C.Func([],[Recovery],[]) });
const Chunk=IDL.Record({hash:Hash}), Upload=IDL.Record({canister_id:P,chunk:Hash});
const Install=IDL.Record({arg:Hash,chunk_hashes_list:IDL.Vec(Chunk),mode:IDL.Variant({install:IDL.Null,upgrade:IDL.Opt(IDL.Record({skip_pre_upgrade:IDL.Opt(IDL.Bool),wasm_memory_persistence:IDL.Opt(IDL.Variant({keep:IDL.Null,replace:IDL.Null}))}))}),sender_canister_version:IDL.Opt(IDL.Nat64),store_canister:IDL.Opt(P),canister_id:P,target_canister:P,wasm_module_hash:Hash});
const management=Principal.fromText("aaaaa-aa"), lowCycles=900_000_000_000n;
function expect(value, tag, label) { if (Object.keys(value).length !== 1 || !(tag in value)) throw new Error(`${label}: expected ${tag}`); }
async function reject(f,label) { try { await f(); } catch (_) { return; } throw new Error(`${label}: expected rejected ingress`); }
async function update(pic,sender,method,type,value) { return pic.client.updateCall({canisterId:management,sender,method,payload:new Uint8Array(IDL.encode([type],[value]))}); }
async function install(pic,sender,id,file,arg,mode={install:null}) { const wasm=fs.readFileSync(file), hashes=[]; for(let o=0;o<wasm.length;o+=1_000_000){const chunk=new Uint8Array(wasm.subarray(o,Math.min(o+1_000_000,wasm.length)));await update(pic,sender,"upload_chunk",Upload,{canister_id:id,chunk});hashes.push({hash:new Uint8Array(crypto.createHash("sha256").update(chunk).digest())});} await update(pic,sender,"install_chunked_code",Install,{arg:new Uint8Array(arg),chunk_hashes_list:hashes,mode,sender_canister_version:[],store_canister:[],canister_id:id,target_canister:id,wasm_module_hash:new Uint8Array(crypto.createHash("sha256").update(wasm).digest())}); }
async function main() { const server=await PocketIcServer.start({binPath:bin,ttl:60,showRuntimeLogs:false,showCanisterLogs:false}), pic=await PocketIc.create(server.getUrl()); try {
  const installer=Principal.fromUint8Array(Uint8Array.of(6,1)), operator=Principal.fromUint8Array(Uint8Array.of(6,2)), outsider=Principal.fromUint8Array(Uint8Array.of(6,3));
  const authorityId=await pic.createCanister({sender:installer,controllers:[installer]}), workflowId=await pic.createCanister({sender:installer,controllers:[installer],cycles:lowCycles});
  const config={core:Principal.fromUint8Array(Uint8Array.of(6,4)),workflow:workflowId,treasury:Principal.fromUint8Array(Uint8Array.of(6,5)),archive:Principal.fromUint8Array(Uint8Array.of(6,6)),evidence:Principal.fromUint8Array(Uint8Array.of(6,7)),governance:Principal.fromUint8Array(Uint8Array.of(6,8))};
  const args=IDL.encode([Config],[config]), fixtureArgs=IDL.encode([P,P],[operator,authorityId]), upgrade={upgrade:[{skip_pre_upgrade:[],wasm_memory_persistence:[{keep:null}]}]};
  await install(pic,installer,authorityId,authorityWasm,args); await install(pic,installer,workflowId,workflowWasm,fixtureArgs);
  const authority=pic.createActor(authorityIdl,authorityId), workflow=pic.createActor(workflowIdl,workflowId), h=n=>Uint8Array.from({length:32},()=>n);
  const input={logicalId:"workflow-completion:v1:synthetic:44",cycleId:"synthetic-cycle-44",operationName:"publish-result",desiredVersion:1n,contentHash:h(9)};
  authority.setPrincipal(outsider); expect(await authority.writeWorkflowCompletionReceipt(input),"blocked","outsider write denied"); expect(await authority.lookupWorkflowCompletionReceipt(input.logicalId),"conflict","outsider lookup denied");
  workflow.setPrincipal(outsider); await reject(()=>workflow.reconcileLostReply(),"outsider recovery denied"); await reject(()=>workflow.repairJournaledReceipt(),"outsider repair denied");
  workflow.setPrincipal(operator); await reject(()=>workflow.writeThenLoseReply(input),"low-cycle journal makes no write"); expect(await workflow.reconcileLostReply(),"retryIdentical","low-cycle receipt remains absent");
  if(await pic.addCycles(workflowId,2_000_000_000_000)<1_000_000_000_000) throw new Error("disposable workflow did not replenish");
  await reject(()=>workflow.retryJournaledWriteThenLoseReply(),"replenished write loses reply"); expect(await workflow.reconcileLostReply(),"acknowledge","replenished receipt reconciles");
  const lost={...input,logicalId:"workflow-completion:v1:synthetic:45",cycleId:"synthetic-cycle-45",contentHash:h(10)};
  await reject(()=>workflow.writeThenLoseReply(lost),"lost workflow receipt reply"); await install(pic,installer,authorityId,authorityWasm,args,upgrade); await install(pic,installer,workflowId,workflowWasm,fixtureArgs,upgrade); workflow.setPrincipal(operator); expect(await workflow.reconcileLostReply(),"acknowledge","exact receipt after upgrades");
  await reject(()=>workflow.writeThenLoseReply(lost),"duplicate workflow delivery loses reply"); expect(await workflow.reconcileLostReply(),"acknowledge","duplicate receipt reconciles");
  const interrupted={...input,logicalId:"workflow-completion:v1:synthetic:46",cycleId:"synthetic-cycle-46",contentHash:h(11)};
  await reject(()=>workflow.journalThenTrapBeforeAwait(interrupted),"workflow interruption"); await install(pic,installer,workflowId,workflowWasm,fixtureArgs,upgrade); workflow.setPrincipal(outsider); await reject(()=>workflow.repairJournaledReceipt(),"outsider repair denied after upgrade"); workflow.setPrincipal(operator); expect(await workflow.repairJournaledReceipt(),"retryIdentical","repair replays retained tuple only"); expect(await workflow.reconcileLostReply(),"acknowledge","repair receipt reconciles");
} finally { await pic.tearDown(); await server.stop(); } }
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
