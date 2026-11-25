/* global chrome */
// "Trazer do meu Chrome" no PC (2026-11-23; src/adapters/executor/chrome-da-pessoa.ts). A extensão liga no host do nod
// (o native messaging app.nod.navegador, que o motor registra) e responde só ao pedido "cookies de UM site": o host
// pergunta, a extensão lê pelo próprio Chrome (`chrome.cookies.getAll`) e devolve. Nada sai sem o pedido do motor, e só
// os cookies que valem para aquele site (o domínio e os pais dele). A porta aberta mantém o service worker acordado.

const NOME_DO_HOST = "app.nod.navegador";
const HOST_VALIDO = /^[a-z0-9.-]{1,253}$/;
let porta = null;

/** Os cookies que o Chrome mandaria para https://<host>/ e http://<host>/ (o domínio e os pais dele). */
async function cookiesDoSite(host) {
  const vistos = new Map();
  for (const url of [`https://${host}/`, `http://${host}/`]) {
    for (const c of await chrome.cookies.getAll({ url })) vistos.set(`${c.domain}|${c.path}|${c.name}`, c);
  }
  return [...vistos.values()].map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expirationDate: c.expirationDate, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite }));
}

function ligar() {
  if (porta) return;
  try { porta = chrome.runtime.connectNative(NOME_DO_HOST); } catch { porta = null; return; }
  porta.onMessage.addListener(async (m) => {
    if (!m || m.tipo !== "cookies" || typeof m.id !== "number" || typeof m.host !== "string" || !HOST_VALIDO.test(m.host)) return;
    try { porta?.postMessage({ tipo: "cookies", id: m.id, cookies: await cookiesDoSite(m.host) }); }
    catch { porta?.postMessage({ tipo: "cookies", id: m.id, erro: "falhou" }); }
  });
  // O motor saiu (ou ainda não subiu): tenta de novo daqui a pouco, pelo alarme (o service worker pode dormir).
  porta.onDisconnect.addListener(() => { porta = null; });
}

chrome.runtime.onStartup.addListener(ligar);
chrome.runtime.onInstalled.addListener(ligar);
chrome.alarms?.onAlarm.addListener(ligar);
ligar();
// A cada minuto o alarme acorda o service worker e religa, se o motor voltou.
chrome.alarms?.create("religar", { periodInMinutes: 1 });
