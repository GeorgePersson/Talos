const { createServer } = require("node:http");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Talos test app</title>
<style>body{margin:60px auto;max-width:640px;font:15px system-ui;color:#26392f;background:#fafbf7}h1{font:46px Georgia}p{line-height:1.7;color:#7c8c75}input,button{font:inherit;padding:12px;border:1px solid #cfdaca;border-radius:6px}button{cursor:pointer;background:#177e69;color:white}pre{padding:20px;background:#eef3e9;border-radius:9px;white-space:pre-wrap}a{color:#177e69}</style>
<span>TALOS / LOCAL TEST FIXTURE</span><h1>Who’s signed in?</h1><p>This local demo mimics a login using browser storage. Open it under several Talos groups to see each identity stay separate.</p>
<form id="login"><input id="identity" aria-label="Demo identity" placeholder="investor@example.test" required><button>Sign in</button></form><p><button id="logout">Sign out</button> <button id="popup">Open login popup</button> <a href="/inbox">Open demo inbox</a></p><pre id="output">Reading session…</pre>
<script>
const db = () => new Promise((resolve,reject) => { const r=indexedDB.open('talos-test',1);r.onupgradeneeded=()=>r.result.createObjectStore('identity');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
window.fixture = {
 async seed(value) {
  document.cookie='identity='+value+'; Path=/; SameSite=Lax';localStorage.setItem('identity',value);sessionStorage.setItem('identity',value);
  const database=await db();await new Promise((resolve,reject)=>{const tx=database.transaction('identity','readwrite');tx.objectStore('identity').put(value,'user');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});database.close();
  const cache=await caches.open('talos-test');await cache.put('/stored',new Response(value));
  await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;return this.read();
 },
 async read() {
  const database=await db();const indexed=await new Promise((resolve,reject)=>{const r=database.transaction('identity').objectStore('identity').get('user');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});database.close();
  const cache=await caches.open('talos-test');const cached=await cache.match('/stored');
  return {cookie:document.cookie,local:localStorage.getItem('identity'),session:sessionStorage.getItem('identity'),indexed,cache:cached?await cached.text():null,workers:(await navigator.serviceWorker.getRegistrations()).length,node:typeof require,bridge:typeof window.qa};
 }
};
const refresh=async()=>document.getElementById('output').textContent=JSON.stringify(await fixture.read(),null,2);
document.getElementById('login').onsubmit=async e=>{e.preventDefault();await fixture.seed(document.getElementById('identity').value);await refresh()};
document.getElementById('logout').onclick=async()=>{document.cookie='identity=; Max-Age=0; Path=/';localStorage.removeItem('identity');await refresh()};
document.getElementById('popup').onclick=()=>window.open('/popup','login','width=650,height=600');
refresh();
</script></html>`;
async function startFixture(port = 0) {
  let cacheRequests = 0;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/")) {
      if (req.url.startsWith("/api/slow")) {
        const timer = setTimeout(() => {
          if (!res.destroyed) res.end("late");
        }, 20000);
        res.on("close", () => clearTimeout(timer));
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      if (req.url.startsWith("/api/redirect")) {
        res.writeHead(302, { Location: "/api/echo" });
        res.end();
        return;
      }
      if (req.url.startsWith("/api/large")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("x".repeat(3 * 1024 * 1024));
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(req.url.includes("/error") ? 503 : 200, {
          "Content-Type": "application/json",
          "X-Test-Response": "talos",
        });
        res.end(
          JSON.stringify({
            method: req.method,
            cookie: req.headers.cookie || "",
            authorization: req.headers.authorization || "",
            body,
            url: req.url,
          }),
        );
      });
      return;
    }
    if (req.url === "/sw.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      });
      res.end(
        "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",
      );
    } else if (req.url?.startsWith("/cached")) {
      cacheRequests++;
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(String(cacheRequests));
    } else if (req.url === "/inbox") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      res.end(
        html
          .replace("<title>Talos test app</title>", "<title>Demo inbox</title>")
          .replace("Who’s signed in?", "Your demo inbox")
          .replace(
            "This local demo mimics a login using browser storage. Open it under several Talos groups to see each identity stay separate.",
            "A pretend inbox for testing group organisation. Real inboxes use the webmail URL you attach to your group.",
          ),
      );
    } else {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      res.end(html);
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    server,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
module.exports = { startFixture };
if (require.main === module)
  startFixture(4173).then((fixture) =>
    console.log(
      "Talos demo website: " +
        fixture.url +
        "\nDemo inbox: " +
        fixture.url +
        "/inbox",
    ),
  );
