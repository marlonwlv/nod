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
 *   curl -XPOST 127.0.0.1:8894/voos      # 1a/5a/C1/D1: "Google Voos" com os 3 melhores voos e a aba "Decolar" (prints lado a lado)
 *   curl -XPOST 127.0.0.1:8894/ajuda     # D3, 8: "O site quer provar que é uma pessoa (CAPTCHA)" (precisa de você)
 *   curl -XPOST 127.0.0.1:8894/caixavoo  # a caixa do voo da TAP no viewport de agora (o cursor do print)
 *   curl -XPOST 127.0.0.1:8894/desligar  # D3, 7: encerra o Chrome do bot (a vista diz "desligado" com [Ligar])
 * Onde o navegador mora (M, J, K, N; pede NOD_MODO=compartilhado e NOD_NAVEGADOR_NA_MAQUINA=1, para as máquinas Linux
 * de mentira contarem como "ligadas" pelo long-poll de verdade):
 *   curl -XPOST 127.0.0.1:8894/maquinas0 # o app do Mac na conta (desligado), nenhuma máquina sempre ligada
 *   curl -XPOST 127.0.0.1:8894/maquinas1 # + vm-sp ligada        /maquinas2: + vm-rio ligada (o computador do bot na vm-sp)
 *   curl -XPOST 127.0.0.1:8894/semapp    # sem o app no computador (só a vm-sp)
 *   curl -XPOST 127.0.0.1:8894/pergunta  # M2/J1: a rotina das 3h traz "Às 3h seu Mac costuma estar desligado"
 *   curl -XPOST 127.0.0.1:8894/macdesligado # K1: "Vê o preço da TAP…" com o Mac desligado → "Seu Mac está desligado"
 *   curl -XPOST 127.0.0.1:8894/avisos    # N: as três linhas de quando o lugar muda sozinho
 *   curl -XPOST 127.0.0.1:8894/terminou  # N4: a linha "✓ Baixou 14 notas fiscais · 3h02 · no nod"
 * A pessoa é a Marlon do seed e o bot é a Vera do seed, renomeada para "Ada" (como no Paper).
 */
import { createServer } from "node:http";
import { FERRAMENTAS_NAVEGADOR_DIRETAS } from "../src/contracts/ferramentas-navegador.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { boot } from "../src/adapters/http/boot.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../src/db/seed/index.ts";
import { log } from "../src/obs/log.ts";
import { autoriaDoAgente } from "../src/use-cases/registrar-negacao.ts";
import { avisoMaquinaSaiu, avisoPrimeiraMaquina } from "../src/domain/navegador-lugar.ts";
import { cunharChaveMaquina } from "../src/services/token-maquina.ts";
import { avisarForaDoAr, avisarNaConversa } from "../src/use-cases/navegador-lugar.ts";

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
const criado = await api("POST", "/agentes", { dono: "pessoa", nome: `Ada ${new Date().toISOString().slice(11, 16).replace(":", "h")}`, titulo: "PM", descricao: "Cuida das contas e das viagens." }) as { agente: { id: string }; conversa: { id: string } };
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
    tenantId: TENANT_PADRAO, turnoId, agenteId: AGENTE, conversaId: CONVERSA, expiraEm: Date.now() + 3_600_000, confiancaEntrada: "confiavel", modoTurno: "conversa",
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
  const js = `(() => { let t = document.querySelector("title"); if (!t) { t = document.createElement("title"); (document.head || document.documentElement).prepend(t); } t.textContent = ${JSON.stringify(titulo)}; document.body.style.cssText = "margin:0;font:15px -apple-system,system-ui,sans-serif;background:#fff;color:#1d1d1f"; document.body.innerHTML = ${JSON.stringify(html)}; return "ok"; })()`;
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

// ---- onde o navegador mora (M, J, K, N): máquinas de mentira pelo caminho de verdade (chave, conectar, long-poll) ----
const chaves = new Map<string, { id: string; chave: string; plataforma: "linux" | "darwin"; parar: AbortController | null }>();
async function maquina(nome: string, plataforma: "linux" | "darwin", ligada: boolean): Promise<void> {
  let k = chaves.get(nome);
  if (!k) {
    const c = cunharChaveMaquina(escopo);
    const criada = await s.app.dentro(escopo, (d) => d.repos.maquinaTokens.criar({ nome, prefixo: c.prefixo, hash: c.hash }));
    if (!criada) throw new Error("sem chave");
    k = { id: criada.id, chave: c.chave, plataforma, parar: null };
    chaves.set(nome, k);
    await s.app.dentro(escopo, (d) => d.repos.maquinaTokens.registrarPlataforma(criada.id, plataforma));
  }
  if (!ligada || k.parar) return;
  const ponte = (rota: string, corpo: unknown, sinal?: AbortSignal) => fetch(`${base}/maquina/${rota}`, { method: "POST", headers: { authorization: `Bearer ${k!.chave}`, "content-type": "application/json", "x-nod-versao": "99.0.0" }, body: JSON.stringify(corpo), ...(sinal ? { signal: sinal } : {}) });
  const r = await ponte("conectar", { versaoContrato: 1, nome, plataforma, inventario: { estado: "ausente", motivo: "demonstração", em: 0 } });
  if (!r.ok) throw new Error(`conectar ${nome} → ${r.status} ${await r.text()}`);
  const parar = new AbortController();
  k.parar = parar;
  void (async () => { while (!parar.signal.aborted) await ponte("navegador/puxar", {}, parar.signal).then((x) => x.text()).catch(() => new Promise((ok) => setTimeout(ok, 500))); })();
}
async function semMaquina(nome: string): Promise<void> {
  const k = chaves.get(nome);
  if (!k) return;
  k.parar?.abort();
  chaves.delete(nome);
  await s.app.dentro(escopo, (d) => d.repos.maquinaTokens.revogar(k.id, Date.now()));
}
// As máquinas de mentira de uma subida anterior saem (a chave crua só existe na memória da subida que a criou).
for (const m of await s.app.dentro(escopo, (d) => d.repos.maquinaTokens.listar())) {
  if (["vm-sp", "vm-rio", "Mac da pessoa"].includes(m.nome)) await s.app.dentro(escopo, (d) => d.repos.maquinaTokens.revogar(m.id, Date.now()));
}
/** Volta a pergunta ao começo: nunca perguntada nem respondida, o interruptor desligado, nenhuma escolha. */
async function lugarDoComeco(continuaSemMac = false): Promise<void> {
  await s.app.dentro(escopo, (d) => d.repos.navegadorPreferencias.gravar(AGENTE, { continuaSemMac, maquinaId: null, noNod: false, soNaMaquina: false, perguntadoEm: null, respondidoEm: null, retomarTurnoId: null }, Date.now()));
}
async function maquinas(n: 0 | 1 | 2, app = true): Promise<unknown> {
  if (app) await maquina("Mac da pessoa", "darwin", false);
  else await semMaquina("Mac da pessoa");
  if (n >= 1) await maquina("vm-sp", "linux", true); else await semMaquina("vm-sp");
  if (n >= 2) await maquina("vm-rio", "linux", true); else await semMaquina("vm-rio");
  await new Promise((ok) => setTimeout(ok, 400));
  return api("GET", `/agentes/${AGENTE}/navegador/lugar`);
}

const VOO = (cor: string, horas: string, linha: string, preco: string, destaque = false) => `<div ${destaque ? "data-voo " : ""}style="display:flex;align-items:center;gap:14px;margin:0 0 14px;padding:14px;border:1px solid #e8eaed;border-radius:10px"><span style="width:28px;height:28px;border-radius:6px;background:${cor}"></span><span style="flex:1"><b style="font-weight:500">${horas}</b><br><small style="color:#666">${linha}</small></span><b style="${destaque ? "color:#16835b" : ""}">${preco}</b></div>`;
const CHIP = (t: string) => `<span style="display:inline-block;margin:0 8px 0 0;padding:7px 12px;border:1px solid #d6d6d6;border-radius:6px;font-size:13px">${t}</span>`;
const PAGINA_VOOS = `<div style="padding:22px 24px;max-width:1100px"><p style="margin:0 0 18px">${CHIP("São Paulo (GRU)")}${CHIP("Lisboa (LIS)")}${CHIP("10 mar – 24 mar")}</p><h3 style="margin:0 0 14px;font-weight:600;font-size:16px">Melhores voos</h3>${VOO("#d0443b", "21:40 – 11:15⁺¹", "TAP · direto · 9 h 35 min", "R$ 3.780", true)}${VOO("#1d1a5c", "18:05 – 10:50⁺¹", "LATAM · 1 parada · 12 h 45 min", "R$ 3.420")}${VOO("#b8232f", "23:55 – 18:20⁺¹", "Iberia · 1 parada · 14 h 25 min", "R$ 3.190")}</div>`;
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
  async voos() {
    await limpar();
    // As páginas de verdade (SPA) refazem o corpo depois que ele é trocado: abre o robots.txt (texto puro, sem script) do
    // mesmo site e põe o caminho de verdade na barra com replaceState (a barra do nod mostra o endereço "de verdade").
    const falso = async (url: string, caminho: string, html: string, titulo: string) => {
      const nova = url.includes("decolar");
      await chamar("navegador_abrir", { url: `${url}/robots.txt`, ...(nova ? { nova_aba: true } : {}) });
      if (nova) { await usar("navegador_abas", { acao: "trocar", aba: 2 }); await chamar("navegador_esperar", { ms: 1500 }); }
      const r = await usar("navegador_avaliar", { expressao: `history.replaceState(null, "", ${JSON.stringify(caminho)}), "ok"` });
      if (r.erro) log("info", "demo_replace", { url, r: JSON.stringify(r).slice(0, 400) });
      return pagina(html, titulo);
    };
    await falso("https://www.google.com", "/travel/flights?q=GRU-LIS", PAGINA_VOOS, "Google Voos");
    // A segunda aba é a Decolar de verdade (só o título e o ícone dela aparecem na barra).
    await chamar("navegador_abrir", { url: "https://www.decolar.com/", nova_aba: true });
    await chamar("navegador_esperar", { ms: 4000 });
    // O site de verdade abre janelas sozinho: ficam só as duas abas do print.
    for (let i = 0; i < 12; i++) {
      const l = await usar("navegador_abas", { acao: "listar" }) as { abas?: unknown[] };
      if (!l.abas || l.abas.length <= 2) break;
      await usar("navegador_abas", { acao: "fechar", aba: l.abas.length });
    }
    await usar("navegador_abas", { acao: "trocar", aba: 1 });
    await chamar("navegador_ler", {});
    // Onde o voo da TAP está no viewport (para o cursor "Ada" do print, que só aparece durante um passo de verdade).
    const caixa = await usar("navegador_avaliar", { expressao: "JSON.stringify((() => { const r = document.querySelector('[data-voo]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })())" });
    return { caixa };
  },
  /** D3, 8 e D1b: o site pede uma pessoa (CAPTCHA): "Precisa de você | Já resolvi | Assumir o controle". */
  async ajuda() {
    await limpar();
    return chamar("navegador_pedir_ajuda", { motivo: "O site quer provar que é uma pessoa (CAPTCHA)" });
  },
  /** A caixa do voo da TAP no viewport de agora (ele acompanha quem assiste): o cursor "Ada" do print vai nela. */
  async caixavoo() {
    const r = await usar("navegador_avaliar", { expressao: "JSON.stringify((() => { const el = document.querySelector('[data-voo]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })())" });
    return JSON.parse(JSON.parse(String(r.resultado ?? "null")) ?? "null");
  },
  /** Onde cada botão da página está agora (o viewport acompanha quem assiste: na tela cheia ele muda). */
  async botoes() {
    return usar("navegador_avaliar", { expressao: "JSON.stringify({ w: innerWidth, h: innerHeight, botoes: [...document.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { nome: b.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }) })" });
  },
  async abas() { return usar("navegador_abas", { acao: "listar" }); },
  async desligar() { await limpar(); return api("POST", `/agentes/${AGENTE}/navegador`, { operacao: "encerrar" }); },
  async maquinas0() { await lugarDoComeco(true); return maquinas(0); },
  async maquinas1() { await lugarDoComeco(true); return maquinas(1); },
  async maquinas2() { await lugarDoComeco(true); return maquinas(2); },
  async semapp() { await lugarDoComeco(true); return maquinas(1, false); },
  async pergunta() {
    await lugarDoComeco(false);
    return api("POST", "/rotinas", { agenteId: AGENTE, cron: "0 3 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Entra no portal da prefeitura e baixa as notas fiscais do dia anterior", fonte: "portal da prefeitura", entregavel: "as notas na pasta", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve" });
  },
  async macdesligado() {
    await limpar();
    await lugarDoComeco(false);
    await maquina("Mac da pessoa", "darwin", false);
    await api("POST", `/conversas/${CONVERSA}/mensagens`, { texto: "Vê o preço da TAP para Lisboa em março." }).catch((e: unknown) => log("info", "demo_msg", { erro: String(e) }));
    return chamar("navegador_abrir", { url: "https://www.google.com/travel/flights" });
  },
  async avisos() {
    const vmSp = chaves.get("vm-sp")?.id ?? null;
    await s.app.dentro(escopo, async (d) => {
      await avisarNaConversa(d, AGENTE, avisoPrimeiraMaquina("vm-sp"), { maquinaId: vmSp, nome: "vm-sp", acao: { rotulo: "Desfazer", mudar: { maquinaId: "nod" } } });
      await avisarForaDoAr(d, AGENTE, { id: vmSp ?? "00000000-0000-4000-8000-000000000000", nome: "vm-sp" });
      await avisarNaConversa(d, AGENTE, avisoMaquinaSaiu("vm-sp"), { maquinaId: vmSp, nome: "vm-sp", acao: null });
    });
    return "ok";
  },
  async terminou() {
    await limpar();
    await chamar("navegador_abrir", { url: "https://nfse.prefeitura.sp.gov.br/" });
    await pagina(`<div style="${CAIXA}"><h2>Nota Fiscal Paulistana</h2><p>14 notas de ontem</p><button>Baixar todas</button></div>`, "NFS-e · Notas emitidas");
    await chamar("navegador_clicar", { alvo: "button" });
    // O turno acaba: o varredor marca "terminou" com o último passo.
    await s.app.dentro(escopo, (d) => d.repos.turnos.assentar(turnoId, { estado: "interrompido", motivoInterrupcao: "sem_progresso" }));
    await s.app.navegadores.pausarOciosos();
    return vista();
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
