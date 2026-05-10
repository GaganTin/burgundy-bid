// Simple E2E test: waits for backend health, then attempts signup and signin
const fetch = global.fetch || (await import('node-fetch')).default;
const base = process.env.API_BASE || 'http://localhost:3001';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitForHealth(timeout=30000){
  const start = Date.now();
  while(Date.now()-start < timeout){
    try{
      const res = await fetch(base+'/_health');
      if (res.ok) return true;
    }catch(e){}
    await sleep(1000);
  }
  throw new Error('Health check timeout');
}
(async ()=>{
  try{
    console.log('Waiting for backend health...');
    await waitForHealth(30000);
    console.log('Backend healthy');
    const email = `e2e+${Date.now()}@example.com`;
    const pwd = 'Password123!';
    console.log('Signing up', email);
    let res = await fetch(base+'/auth/signup', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ full_name: 'E2E User', email, password: pwd })});
    let j = await res.json();
    console.log('Signup status', res.status, j);
    if (res.status === 409){
      console.log('User already exists, proceeding to signin');
    }
    console.log('Signing in');
    res = await fetch(base+'/auth/signin', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password: pwd })});
    j = await res.json();
    console.log('Signin status', res.status, j);
    if (res.ok) console.log('E2E sign-in successful. Token length:', (j.token||'').length);
    process.exit(res.ok?0:2);
  }catch(err){
    console.error('E2E failed:', err);
    process.exit(3);
  }
})();
