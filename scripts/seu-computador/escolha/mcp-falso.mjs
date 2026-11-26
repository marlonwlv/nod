// Servidor MCP falso: lista as ferramentas do plano e registra cada chamada (nome e argumentos) num arquivo.
import { appendFileSync, readFileSync } from "node:fs";
const [ferramentas, log] = process.argv.slice(2);
const tools = JSON.parse(readFileSync(ferramentas, "utf8"));
let buf = "";
const resp = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.method === "initialize") resp(m.id, { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "1" } });
    else if (m.method === "tools/list") resp(m.id, { tools });
    else if (m.method === "tools/call") {
      appendFileSync(log, JSON.stringify({ nome: m.params.name, args: m.params.arguments }) + "\n");
      resp(m.id, { content: [{ type: "text", text: "ok (teste: pare aqui e responda em uma frase o que fez)" }] });
    } else if (m.id !== undefined) resp(m.id, {});
  }
});
