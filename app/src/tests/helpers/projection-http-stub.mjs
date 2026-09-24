import{createProjectionReceiverServer}from'../../server/review-real/receiver-http.ts';
import{performance}from'node:perf_hooks';
const mode=process.argv[2];let calls=0;
const server=createProjectionReceiverServer({senderServiceIdentity:'synthetic-worker-test',receiver:{receive(value){calls++;process.send({event:'receive',at:Date.now(),calls});if(mode==='slow'){const until=performance.now()+35000;while(performance.now()<until){}}process.send({event:'stub-commit',at:Date.now(),calls});return mode==='large'?{data:'a'.repeat(70*1024)}:{synthetic:true,received:true,characters:value.synthetic?.length??0};},getReceipt(id){calls++;return{synthetic:true,id};}}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string'||[3101,3102].includes(address.port))throw Error('TEST_PORT');
process.send({event:'listening',port:address.port});
process.on('message',m=>{if(m==='close'){server.closeAllConnections();server.close(()=>{process.send({event:'closed',calls});process.disconnect();});}});
process.on('disconnect',()=>{server.closeAllConnections();server.close();});
setTimeout(()=>process.exit(88),50000).unref();
