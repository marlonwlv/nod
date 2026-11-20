/**
 * Demonstração do navegador do bot para prints e QA de interface (ADR-190; Paper L, A, T). Sobe o nod inteiro neste
 * processo (boot.ts, o mesmo do `npm start`) e põe o navegador do bot nos estados dos cartões chamando o PORTÃO de
 * verdade (`navegadores.chamar`) com um plano falso — nenhum modelo roda e nada custa assinatura. O motor é o
 * agent-browser de verdade (NOD_NAVEGADOR_NO_SERVIDOR=1), então a vista ao vivo mostra a página.
 *
 * Uso (banco efêmero próprio, nunca o diário; a web montada antes com `npx vite build`):
 *   NOD_BANCO_AMBIENTE=efemero DATABASE_URL=… DATABASE_URL_DONO=… NOD_LOGIN=stub NOD_STATIC_DIR=dist/web \
 *   NOD_NAVEGADOR_NO_SERVIDOR=1 NOD_EXECUTOR=catcher NOD_API_PORT=8893 node scripts/navegador-demo.ts
 * Depois, cada estado é um POST no controle (só loopback, porta NOD_DEMO_PORTA, padrão 8894):
 *   curl -XPOST 127.0.0.1:8894/login     # L1: "Ada precisa entrar no Itaú" (cofre do nod)
 *   curl -XPOST 127.0.0.1:8894/codigo    # L4: "O Itaú mandou um código por SMS"
 *   curl -XPOST 127.0.0.1:8894/pagar     # A1: "Pagar R$ 3.780 no flytap.com?"
 *   curl -XPOST 127.0.0.1:8894/combinar  # A2: "Vou comprar em flytap.com: 1 passagem, até R$ 4.000,00"
 *   curl -XPOST 127.0.0.1:8894/enviar    # A3: "Enviar … no web.whatsapp.com?" com a citação e o "Não perguntar de novo"
 *   curl -XPOST 127.0.0.1:8894/faturas   # T: a página com "Faturas" e "Novembro" para ensinar
 *   curl -XPOST 127.0.0.1:8894/limpar    # fecha o pedido aberto (recusa ou resolve)
 * A pessoa é a Marlon do seed e o bot é a Vera do seed, renomeada para "Ada" (como no Paper).
 */
import { createServer } from "node:http";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../src/contracts/ferramentas-navegador.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { boot } from "../src/adapters/http/boot.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../src/db/seed/index.ts";
import { log } from "../src/obs/log.ts";
import { autoriaDoAgente } from "../src/use-cases/registrar-negacao.ts";

const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const PORTA_CONTROLE = Number(process.env.NOD_DEMO_PORTA ?? 8894);

// O orquestrador quase parado: os turnos do plano falso ficam na fila (o catcher não responde neles na conversa).
const s = await boot({ env: process.env, intervalos: { orquestradorMs: 6 * 3_600_000 } });
const base = `${s.url}/api`;

/** A sessão da pessoa (o login stub, só em loopback). */
const entrou = await fetch(`${base}/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId: PESSOA_MARLON }) });
const cookie = (entrou.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
async function api(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  const r = await fetch(`${base}/t/${TENANT_PADRAO}${caminho}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

// Um bot novo, "Ada" (como no Paper), com a conversa limpa a cada vez que o demo sobe.
const criado = await api("POST", "/agentes", { dono: "pessoa", nome: `Ada ${new Date().toISOString().slice(11, 16).replace(":", "h")}`, titulo: "Assistente", descricao: "Cuida das contas e das viagens." }) as { agente: { id: string }; conversa: { id: string } };
const AGENTE = criado.agente.id;
const CONVERSA = criado.conversa.id;
await api("PATCH", `/agentes/${AGENTE}`, { nome: "Ada" }).catch((e: unknown) => log("info", "demo_nome", { erro: String(e) }));
// Manual: enviar (A3) pede a pessoa; no automático sem revisor, o envio passaria direto.
await api("POST", `/agentes/${AGENTE}/modo-aprovacao`, { modo: "manual" });
log("info", "demo_bot", { agente: AGENTE, conversa: CONVERSA, criado: JSON.stringify(criado).slice(0, 300) });
// O cofre do nod com os logins que casam (L1, M4), um por site: a senha é de mentira.
const noCofre = ((await api("GET", "/cofre/logins")) as { logins: { id: string; site: string }[] }).logins;
const jaNoCofre: string[] = [];
for (const l of noCofre) {
  if (jaNoCofre.includes(l.site)) await api("DELETE", `/cofre/logins/${l.id}`);
  else jaNoCofre.push(l.site);
}
for (const site of ["itau.com.br", "flytap.com"]) if (!jaNoCofre.includes(site)) await api("POST", "/cofre/logins", { site, usuario: "marlon@exemplo.com", senha: "demo-123" });

/**
 * O turno que "chama" as ferramentas: o portão exige um turno vivo do bot. Um executor que este servidor não roda deixa
 * o turno na fila, e o `acordarEm` daqui a 6 h faz o orquestrador não o pegar; o plano falso aponta para ele.
 */
async function turnoVivo(): Promise<string> {
  const t = await s.app.dentro(escopo, (d) => d.repos.turnos.enfileirar({ executor: "codex-cli", conversaId: CONVERSA, agenteId: AGENTE, origem: "conversa", prazoEm: Date.now() + 6 * 3_600_000, profundidade: 0, entradaTexto: "demonstração do navegador", entradaConfianca: "confiavel", modelo: "sonnet", harness: "codex-cli", acordarEm: Date.now() + 6 * 3_600_000 } as never));
  if (!t) throw new Error("sem turno");
  return t.id;
}
let turnoId = await turnoVivo();

function plano(): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO, turnoId, agenteId: AGENTE, conversaId: CONVERSA, expiraEm: Date.now() + 3_600_000, confiancaEntrada: "confiavel",
    autoria: autoriaDoAgente(escopo, AGENTE),
    catalogo: { ferramentas: Object.keys(FERRAMENTAS_NAVEGADOR_DIRETAS).map((nome) => ({ nome, origem: "navegador" })) },
  } as never;
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await s.app.navegadores.chamar(escopo, plano(), nome, args);
  const corpo = "conteudo" in r && typeof r.conteudo === "string" ? JSON.parse(r.conteudo) as Record<string, unknown> : (r as Record<string, unknown>);
  log("info", "demo_chamada", { ferramenta: nome, ok: !("isError" in r && r.isError), negacao: "negacao" in r ? String((r as { negacao: unknown }).negacao) : null });
  return corpo;
}
const usar = (ferramenta: string, argumentos: Record<string, unknown>) => chamar("navegador_usar", { ferramenta, argumentos });

/** Troca o corpo da página (a página de mentira de cada estado) e lê de novo. Devolve as referências por nome. */
async function pagina(html: string, titulo: string): Promise<Record<string, string>> {
  const js = `(() => { document.title = ${JSON.stringify(titulo)}; document.body.style.cssText = "margin:0;font:15px -apple-system,system-ui,sans-serif;background:#fff;color:#1d1d1f"; document.body.innerHTML = ${JSON.stringify(html)}; return "ok"; })()`;
  await usar("navegador_avaliar", { expressao: js });
  const l = await chamar("navegador_ler", {});
  const refs: Record<string, string> = {};
  for (const m of String(l.arvore ?? "").matchAll(/- (\w+) "([^"]+)"[^\n]*\[ref=(e\d+)\]/g)) refs[m[2] ?? ""] = `@${m[3]}`;
  return refs;
}

const vista = () => s.app.navegadores.vistaDe(escopo, AGENTE);

/** Fecha o pedido aberto: a aprovação é recusada pela decisão; login e ajuda, pelo "Já resolvi". Um turno novo para o próximo. */
async function limpar(): Promise<void> {
  const p = vista().pedido;
  if (p?.tipo === "aprovacao" || p?.tipo === "combinar") {
    // Recusar uma aprovação é desmarcar os itens (o `recusar: true` vale só para pergunta e proposta).
    const itens = await s.app.dentro(escopo, (d) => d.repos.itensAprovacao.listar(p.decisaoId));
    await api("POST", `/decisoes/${p.decisaoId}/decidir`, { itens: itens.map((i) => ({ id: i.id, selecionado: false })) }).catch(() => undefined);
  }
  else if (p) await api("POST", `/agentes/${AGENTE}/navegador`, { operacao: "resolver" }).catch(() => undefined);
  if (vista().controle === "pessoa") await api("POST", `/agentes/${AGENTE}/navegador`, { operacao: "devolver" }).catch(() => undefined);
  turnoId = await turnoVivo();
}

const CAIXA = "max-width:520px;margin:48px auto;padding:0 24px";
const ESTADOS: Record<string, () => Promise<unknown>> = {
  async login() {
    await limpar();
    await chamar("navegador_abrir", { url: "https://www.itau.com.br/" });
    await pagina(`<div style="${CAIXA}"><h2 style="color:#ec7000">Itaú</h2><label>Usuário <input style="display:block;width:100%;padding:10px;margin:6px 0 14px"></label><button style="padding:10px 18px;background:#ec7000;color:#fff;border:0;border-radius:8px">Acessar</button></div>`, "Itaú · Acesse sua conta");
    return chamar("navegador_entrar", { site: "Itaú", motivo: "Para baixar a fatura de novembro" });
  },
  async codigo() {
    await limpar();
    return chamar("navegador_pedir_ajuda", { motivo: "O Itaú mandou um código por SMS", codigo: true });
  },
  async pagar() {
    await limpar();
    await chamar("navegador_abrir", { url: "https://www.flytap.com/" });
    const refs = await pagina(`<div style="${CAIXA}"><h2>TAP · Revisar pedido</h2><p>Lisboa → São Paulo · 10/3 · 21:40 · 1 adulto</p><p style="font-size:22px"><b>R$ 3.780</b></p><button style="padding:12px 20px;background:#1c1c1c;color:#fff;border:0;border-radius:8px">Pagar R$ 3.780</button></div>`, "TAP · Revisar pedido");
    return chamar("navegador_clicar", { alvo: refs["Pagar R$ 3.780"] ?? "@e1" });
  },
  async combinar() {
    await limpar();
    return usar("navegador_combinar", { site: "flytap.com", o_que: "1 passagem", ate_valor_centavos: 400_000 });
  },
  async enviar() {
    await limpar();
    await chamar("navegador_abrir", { url: "https://web.whatsapp.com/" });
    const refs = await pagina(`<div style="${CAIXA}"><h2>Pedro</h2><p style="color:#667">visto por último hoje às 18:02</p><label>Mensagem <input aria-label="Mensagem" style="display:block;width:100%;padding:10px;margin:6px 0 14px"></label><button>Enviar</button></div>`, "WhatsApp · Pedro");
    await chamar("navegador_preencher", { alvo: refs.Mensagem ?? "@e1", texto: "Pedro, a passagem saiu: TAP, 10/3, 21:40." });
    return chamar("navegador_clicar", { alvo: refs.Enviar ?? "@e2", para: "Pedro" });
  },
  async faturas() {
    await limpar();
    await chamar("navegador_abrir", { url: "https://www.itau.com.br/" });
    await pagina(`<div style="${CAIXA}"><h2 style="color:#ec7000">Itaú · Faturas</h2><p><button style="padding:8px 14px">Faturas</button> <button style="padding:8px 14px">Outubro</button> <button style="padding:8px 14px">Novembro</button></p><p><button style="padding:10px 16px;background:#ec7000;color:#fff;border:0;border-radius:8px">Baixar PDF</button></p></div>`, "Itaú · Faturas");
    // Onde cada botão está na página (coordenadas do viewport): quem tira os prints clica neles pela vista, com a pessoa
    // no controle, e a gravação de "Ensinar" registra os cliques.
    return usar("navegador_avaliar", { expressao: "JSON.stringify({ w: innerWidth, h: innerHeight, botoes: [...document.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { nome: b.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }) })" });
  },
  async limpar() { await limpar(); return vista(); },
  async vista() { return vista(); },
  async info() { return { agenteId: AGENTE, conversaId: CONVERSA }; },
};

const controle = createServer((req, res) => {
  const nome = (req.url ?? "/").replace(/^\//, "");
  const fn = req.method === "POST" ? ESTADOS[nome] : undefined;
  if (!fn) { res.writeHead(404).end(); return; }
  fn().then((r) => { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, r, vista: vista() })); })
    .catch((e: unknown) => { log("erro", "demo_falhou", { estado: nome, pilha: e instanceof Error ? (e.stack ?? "").split("\n").slice(0, 40).join(" | ") : String(e) }); res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, erro: String(e) })); });
});
controle.listen(PORTA_CONTROLE, "127.0.0.1", () => log("info", "demo_no_ar", { app: s.url, controle: `http://127.0.0.1:${PORTA_CONTROLE}`, cookie: cookie.split("=")[0] ?? "" }));

const sair = () => { controle.close(); void s.fechar().finally(() => process.exit(0)); };
process.on("SIGINT", sair);
process.on("SIGTERM", sair);
