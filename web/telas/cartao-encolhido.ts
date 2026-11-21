import type { Mensagem, PayloadMensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora, paragrafos } from "../lib/render.ts";
import { iconeDaLinha } from "../lib/card-proposta.ts";
import { ondeLegivel } from "./card-pasta.ts";
import { acaoHumana, FRASE_ACAO_NO_COMPUTADOR, linhaNaoPermitiu } from "./sua-vez.ts";
import { ehRotinaWebhook, enderecoNoCard, origemDaTela } from "./webhook.ts";
import { conectorDoApp, nomeDoApp } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";
import { fraseCurta } from "../lib/pedidos-que-esperam.ts";

/**
 * O cartão encolhido (definido em 2026-10-18, plano do chat limpo, Parte 3 · 3A, PR 4; protótipo "D3A · Cartão encolhido",
 * escolhido pelo Marlon). Decidido, o cartão de aprovação, proposta, acesso, pasta ou regra encolhe no lugar em vez de
 * sumir e deixar um recibo no fim da conversa: o título do pedido ("Enviar e-mail para Helena Souza · 'Re: Proposta Q4'")
 * e uma linha com o resultado ("Aprovado por você · feito 08:14 ✓", "Recusado por você", "Acesso permitido · Gmail").
 * É o mesmo gesto da pergunta respondida da Fase 2 e usa as classes do cartão dela (`cartao-pergunta respondida`,
 * `pq-escolhida`, `pq-estado`), sem mexer em web/telas/cartao-pergunta.ts.
 *
 * O lugar (a âncora do pedido) é de web/telas/conversa.ts; aqui, o que cada recibo diz. "ver o e-mail" do protótipo fica
 * como "detalhes" (os itens, como o recibo de antes): nenhum conector devolve link hoje (decisão tomada 4). O registro de
 * autorização do acesso e da regra continua legível, em "Ver registro de autorização" (emenda da ADR-044).
 */

/** `ok`: ✓ verde; `falha`: ! em vermelho; `regra`: o cadeado; null (recusa): a linha discreta, sem a caixa. */
export type MarcaDoEncolhido = "ok" | "falha" | "regra" | "sem-resposta" | null;

export type DadosDoEncolhido = {
  /** A decisão ou a proposta: a chave do foco e do anúncio de quem decidiu nesta aba (web/lib/foco-do-encolhido.ts). */
  decisaoId: string;
  titulo: string;
  resultado: string;
  marca: MarcaDoEncolhido;
  /** O que a região `aria-live` da conversa diz quando o cartão nasce de um clique nesta aba ("Aprovado: …"). */
  anuncio: string;
  /** O que abre: os itens da aprovação ou o registro de autorização (`chave` é a do `data-disclosure`). */
  detalhes?: { rotulo: string; html: string; chave: string };
  /** HTML depois da linha do resultado (a pasta: onde fica e "Trocar"). */
  rodape?: string;
  /** O title da linha: quem decidiu e quando (o Paper tira da linha). */
  dica?: string;
  /** Spec D, item 5: a recusa de uma ação no computador é uma linha de sistema centrada ("Você não permitiu: …"). */
  sistema?: true;
};

/**
 * O desenho de cada marca; `null` é a recusa. Só o ícone tem cor: a linha é neutra (NOD-399). Tela 06 do Paper
 * ("Resolvido"): a recusa é o × vermelho e a regra nova é o visto verde de "Permitido sempre".
 */
const ICONE_NEGADO = '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const MARCA: Record<Exclude<MarcaDoEncolhido, null>, string> = {
  ok: iconeDaLinha("ok"),
  falha: '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.6"/><path d="M8 11v.01"/></svg>',
  regra: iconeDaLinha("ok"),
  // Item 10, rodada 2: o pedido que a mensagem nova substituiu — nem feito nem negado; a seta aponta a conversa abaixo.
  "sem-resposta": '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/></svg>',
};

/** O leitor de tela ouve o estado depois da linha (a marca é desenho). */
const NOME_DA_MARCA: Record<Exclude<MarcaDoEncolhido, null>, string> = { ok: "feito", falha: "não saiu", regra: "regra", "sem-resposta": "você mandou outra mensagem antes de responder" };

/**
 * NOD-399: o card decidido vira UMA linha (`.cp-linha` de web/card-proposta.css): a marca, o resultado ("✓ Confirmado
 * por você") e, depois do separador, o título do pedido, discreto. O que abre (registro, itens) e o rodapé da pasta ficam
 * numa segunda linha (`cp-extra`). O título continua focável (tabindex -1, web/lib/foco-do-encolhido.ts) e dá o nome ao
 * grupo.
 *
 * `mensagemId` é o recibo: o id do título sai dele, e não da decisão, porque "Sempre permitir" grava dois recibos da
 * mesma decisão (o resultado e a regra) e os dois cartões teriam o mesmo `id` no DOM (o `aria-labelledby` de um apontaria
 * o título do outro).
 */
export function renderCartaoEncolhido(d: DadosDoEncolhido, mensagemId: string): string {
  const id = esc(d.decisaoId);
  const titulo = `ce-t-${esc(mensagemId)}`;
  const tipo = d.marca === null ? "recusado" : d.marca;
  const marca = d.marca === null ? ICONE_NEGADO : `${MARCA[d.marca]}`;
  const sr = d.marca === null ? "" : `<span class="sr-only"> (${NOME_DA_MARCA[d.marca]})</span>`;
  // Tela 06 do Paper: o que abre (registro, itens) é o link do fim da linha ("· Editar", "· Desfazer"); o corpo abre
  // embaixo, na linha inteira.
  const detalhes = d.detalhes ? `<details class="ce-detalhes" data-disclosure="${esc(d.detalhes.chave)}"><summary><span class="cp-sep" aria-hidden="true">·</span> <span class="ce-link">${esc(d.detalhes.rotulo)}</span></summary><div class="ce-corpo">${d.detalhes.html}</div></details>` : "";
  const extra = d.rodape ?? "";
  if (d.sistema) return `<div class="msg-sistema cc-linha cartao-encolhido" role="group" aria-labelledby="${titulo}" data-cartao-encolhido="${id}" data-anuncio="${esc(d.anuncio)}"${d.dica ? ` title="${esc(d.dica)}"` : ""}><span id="${titulo}" tabindex="-1">${esc(d.resultado)}</span></div>`;
  // O título leva tabindex -1: o foco vai para ele quando o cartão nasce de um clique nesta aba (o botão clicado já saiu).
  return `<div class="cp-linha cp-${tipo} cartao-encolhido${extra ? " cp-com-extra" : ""}" role="group" aria-labelledby="${titulo}" data-cartao-encolhido="${id}" data-anuncio="${esc(d.anuncio)}"${d.dica ? ` title="${esc(d.dica)}"` : ""}>`
    + `${marca}<span class="cp-texto"><span class="ce-resultado">${esc(d.resultado)}</span>${sr} ${d.resultado.endsWith(":") ? "" : '<span class="cp-sep" aria-hidden="true">·</span> '}<span class="pq-titulo ce-titulo" id="${titulo}" tabindex="-1">${esc(d.titulo)}</span></span>${detalhes}`
    + (extra ? `<div class="cp-extra">${extra}</div>` : "")
    + "</div>";
}

type Payload<K extends NonNullable<PayloadMensagem>["kind"]> = Extract<PayloadMensagem, { kind: K }>;

const DESFECHO: Record<string, string> = { executado: "feito", retirado_pela_pessoa: "você tirou", sensivel_nao_aprovado: "dado pessoal, não aprovado", falhou_na_execucao: "falhou ao executar", ja_executado: "já feita" };

const maiuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "por você"; decidido por outra pessoa (a decisora, ADR-007), sem nome: a web só conhece o nome de quem está na sessão. */
function porQuem(m: Mensagem, estado: Estado): string {
  return m.autoria.autor_id === estado.sessao?.pessoaId ? " por você" : "";
}

/** "ler no Gmail e editar no Gmail" vira "ler e editar no Gmail" quando o app é um só. */
function acoesHumanas(estado: Estado, nomes: readonly { slug: string; ferramenta: string }[]): string {
  const frases = [...new Set(nomes.map((n) => acaoHumana(estado.conectores, n.slug, n.ferramenta)))];
  const sufixos = new Set(frases.map((f) => f.slice(f.lastIndexOf(" no ") + 1)));
  if (sufixos.size === 1 && frases.every((f) => f.includes(" no "))) {
    const [sufixo] = [...sufixos];
    return `${frases.map((f) => f.slice(0, f.lastIndexOf(" no "))).join(" e ")} ${sufixo}`;
  }
  return frases.join(" e ");
}

function daAprovacao(m: Mensagem, p: Payload<"resultado_aprovacao">, estado: Estado): DadosDoEncolhido {
  const total = p.itens.length;
  // NOD-282 (G6): "já feita" (a ação saiu numa decisão posterior) conta como feita.
  const feita = (d: string) => d === "executado" || d === "ja_executado";
  const feitos = p.itens.filter((i) => feita(i.desfecho)).length;
  const aprovados = p.itens.filter((i) => feita(i.desfecho) || i.desfecho === "falhou_na_execucao").length;
  const titulo = p.frase ?? (total === 1 && p.itens[0]?.texto ? p.itens[0].texto : `${total} ${total === 1 ? "ação" : "ações"}`);
  const quem = porQuem(m, estado);
  const comTexto = p.itens.some((i) => i.texto);
  const itens = comTexto
    ? `<ul class="recibo-itens">${p.itens.map((i) => `<li class="recibo-item-${feita(i.desfecho) ? "ok" : i.desfecho === "falhou_na_execucao" ? "falha" : "recusa"}"><span>${esc(i.texto ?? "")}</span><small>${esc(DESFECHO[i.desfecho] ?? i.desfecho.replaceAll("_", " "))}</small></li>`).join("")}</ul>`
    : `<p class="recibo-texto">${paragrafos(m.texto)}</p>`;
  const detalhes = { rotulo: "detalhes", html: itens, chave: `encolhido-${m.id}` };
  // PR 4 dos modos de aprovação: o cartão do revisor tinha "Negar"; o encolhido usa o mesmo verbo.
  // Tela 06 do Paper ("Resolvido"): "Negado · <o pedido>" e "Permitido uma vez · <o pedido>"; quem decidiu e a hora ficam
  // no title (a linha é de status, não de recibo).
  const quando = `Decidido${quem} às ${hora(m.criadoEm)}`;
  // Spec D, item 5: negar a ação no computador vira "Você não permitiu: {ação}", centrada; o bot segue o turno.
  // Item 10, rodada 2 (src/use-cases/substituir-aprovacoes.ts): a pessoa mandou outra mensagem com o pedido aberto. Como o
  // "Asked again below" do app de referência: não é "Negado" — o bot segue pela mensagem nova e pede de novo se precisar.
  if (p.substituida) return { decisaoId: p.decisaoId, titulo, resultado: "Sem resposta", marca: "sem-resposta", anuncio: `Sem resposta: ${titulo}`, dica: `Você mandou outra mensagem antes de responder, às ${hora(m.criadoEm)}. Nada rodou.` };
  const [unico] = p.itens;
  if (aprovados === 0 && total === 1 && p.frase === FRASE_ACAO_NO_COMPUTADOR && unico?.texto && quem) {
    const linha = linhaNaoPermitiu(unico.texto);
    return { decisaoId: p.decisaoId, titulo, resultado: linha, marca: null, anuncio: linha, dica: quando, sistema: true };
  }
  if (aprovados === 0) return p.revisor
    ? { decisaoId: p.decisaoId, titulo, resultado: "Negado", marca: null, anuncio: `Negado: ${titulo}`, dica: quando }
    : { decisaoId: p.decisaoId, titulo, resultado: "Negado", marca: null, anuncio: `Recusado: ${titulo}`, dica: quando };
  if (feitos === aprovados) {
    const resultado = total === 1 ? "Permitido uma vez" : `Permitido · ${feitos} de ${total} ${feitos === 1 ? "feita" : "feitas"}`;
    // Um item que deu certo não tem o que abrir: a linha já diz tudo.
    return { decisaoId: p.decisaoId, titulo, resultado, marca: "ok", anuncio: `Aprovado: ${titulo}`, dica: quando, ...(total > 1 ? { detalhes } : {}) };
  }
  const falhas = aprovados - feitos;
  const resultado = feitos === 0 ? "Aprovado · não saiu" : `Aprovado · ${falhas} de ${aprovados} não ${falhas === 1 ? "saiu" : "saíram"}`;
  return { decisaoId: p.decisaoId, titulo, resultado, marca: "falha", anuncio: `Aprovado, mas não saiu: ${titulo}`, detalhes };
}

function registro(m: Mensagem): DadosDoEncolhido["detalhes"] {
  return { rotulo: "Ver registro de autorização", html: `<p class="recibo-texto">${paragrafos(m.texto)}</p>`, chave: `consentimento-${m.id}` };
}

function doAcesso(m: Mensagem, p: Payload<"consentimento">, estado: Estado): DadosDoEncolhido {
  const caps = "capacidades" in p ? p.capacidades : [p.capacidade];
  const decisaoId = "decisaoId" in p && p.decisaoId ? p.decisaoId : m.id;
  const frase = "frase" in p && p.frase ? p.frase : null;
  const conector = estado.conectores.find((c) => c.slug === p.slug);
  const app = conector?.nome ?? p.slug;
  // Sem a frase (consentimento sem pedido, ou de antes de 18/10): o que foi liberado em português quando o catálogo diz o
  // grupo de cada ferramenta; senão o nome da ferramenta (uma) ou a contagem.
  const comGrupo = caps.every((cap) => {
    const grupo = conector?.catalogo.find((c) => c.nome === cap)?.grupo;
    return grupo !== undefined && grupo !== "outras";
  });
  const titulo = frase ?? (comGrupo ? maiuscula(acoesHumanas(estado, caps.map((ferramenta) => ({ slug: p.slug, ferramenta })))) : caps.length === 1 ? caps[0] ?? app : `${caps.length} ações no ${app}`);
  return { decisaoId, titulo, resultado: `Acesso permitido · ${app}`, marca: "ok", anuncio: `Acesso permitido: ${titulo}`, detalhes: registro(m) };
}

function daRegra(m: Mensagem, p: Payload<"regra_permanente">, estado: Estado): DadosDoEncolhido {
  const nomes = p.acoes.map((n) => {
    const ponto = n.indexOf(".");
    return ponto > 0 ? { slug: n.slice(0, ponto), ferramenta: n.slice(ponto + 1) } : { slug: n, ferramenta: n };
  });
  const titulo = acoesHumanas(estado, nomes);
  return { decisaoId: p.decisaoId, titulo, resultado: "Permitido sempre:", marca: "regra", anuncio: `Permitido sempre: ${titulo}`, detalhes: registro(m) };
}

function daPasta(p: Payload<"pasta_aberta">, estado: Estado): DadosDoEncolhido {
  const agente = estado.frota?.agentes.find((a) => a.id === p.agenteId && !a.excluidoEm);
  const dono = agente !== undefined && agente.ownerId === estado.sessao?.pessoaId;
  const onde = ondeLegivel({ caminho: p.pasta, ...(p.onde !== undefined ? { onde: p.onde } : {}) });
  const rodape = `<p class="ce-rodape" title="${esc(p.pasta)}"><span>${esc(onde)}</span>${dono ? botao("abrir-workspace", "Trocar", { classe: "link", id: p.agenteId }) : ""}</p>`;
  return { decisaoId: p.propostaId, titulo: `Abrir o projeto ${p.nome}`, resultado: `${p.nome} aberta para ${agente?.nome ?? "o agente"}`, marca: "ok", anuncio: `Pasta aberta: ${p.nome}`, rodape };
}

function daProposta(m: Mensagem, p: Payload<"proposta_decidida">, estado: Estado): DadosDoEncolhido {
  const quem = porQuem(m, estado);
  // NOD-50: o cartão de credencial encolhe sem nada do valor; guardada leva o "Trocar" para Configurações avançadas.
  if (p.tipo === "credencial") {
    return p.estado === "confirmada"
      ? { decisaoId: p.propostaId, titulo: p.titulo, resultado: "Guardada no cofre", marca: "ok", anuncio: `${p.titulo}: guardada no cofre`, rodape: `<p class="ce-rodape"><span>O bot não vê a chave.</span>${botao("abrir-avancado", "Trocar", { classe: "link", aria: "Trocar a chave em Configurações avançadas" })}</p>` }
      : { decisaoId: p.propostaId, titulo: p.titulo, resultado: `Deixada de lado${quem}`, marca: null, anuncio: `${p.titulo}: deixada de lado` };
  }
  // NOD-84: a rotina por webhook confirmada guarda o endereço no card encolhido (mascarado, copiar e Enviar teste). O id
  // da proposta de rotina é o id da rotina.
  const webhook = p.estado === "confirmada" && p.tipo === "rotina" ? estado.rotinas.find((r) => r.rotina.id === p.propostaId && r.rotina.ownerId === estado.sessao?.pessoaId) : undefined;
  const rodape = webhook && ehRotinaWebhook(webhook) && webhook.rotina.excluidoEm === null ? enderecoNoCard(webhook, origemDaTela(), estado.agora) : "";
  return p.estado === "confirmada"
    ? { decisaoId: p.propostaId, titulo: p.titulo, resultado: `Confirmado${quem}`, marca: "ok", anuncio: `Confirmado: ${p.titulo}`, ...(rodape ? { rodape } : {}) }
    : { decisaoId: p.propostaId, titulo: p.titulo, resultado: `Recusado${quem}`, marca: null, anuncio: `Recusado: ${p.titulo}` };
}

/**
 * O cartão encolhido que o recibo vira, ou null quando ele continua a linha de antes: o recibo automático sem payload
 * (não houve cartão), o "permitiu para sempre" antigo (sem payload) e o consentimento da aprovação automática (não houve
 * clique; mora na Atividade).
 */
export function dadosDoEncolhido(m: Mensagem, estado: Estado): DadosDoEncolhido | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "resultado_aprovacao":
      return daAprovacao(m, p, estado);
    case "consentimento":
      return m.autoria.decidido_por === "pessoa" ? doAcesso(m, p, estado) : null;
    case "regra_permanente":
      return daRegra(m, p, estado);
    case "pasta_aberta":
      return daPasta(p, estado);
    case "proposta_decidida":
      return daProposta(m, p, estado);
    default:
      return null;
  }
}

/**
 * O turno do pedido que o recibo resolve, a âncora do cartão (null = sem âncora: encolhe onde o recibo está). O
 * `resultado_aprovacao` é gravado no turno da decisão; os outros levam o turno no payload (os gravados antes, sem ele).
 */
export function turnoDoEncolhido(m: Mensagem): string | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "resultado_aprovacao":
      return m.turnoId;
    case "consentimento":
      return "turnoId" in p ? p.turnoId ?? null : null;
    case "regra_permanente":
    case "proposta_decidida":
    case "pedido_dispensado":
      return p.turnoId;
    case "pasta_aberta":
      return p.turnoId ?? null;
    default:
      return null;
  }
}

/** O pedido que o recibo fecha: o cartão aberto de mesmo id não é desenhado de novo (a fila "Sua vez" relê depois). */
export function pedidoDoRecibo(m: Mensagem): string | null {
  const p = m.payload;
  if (!p) return null;
  switch (p.kind) {
    case "resultado_aprovacao":
    case "regra_permanente":
    case "pedido_dispensado":
      return p.decisaoId;
    case "consentimento":
      return "decisaoId" in p ? p.decisaoId ?? null : null;
    case "pasta_aberta":
    case "proposta_decidida":
      return p.propostaId;
    default:
      return null;
  }
}

/**
 * O pedido que a pessoa deixou para trás ao seguir conversando (definido em 2026-11-20, ADR-191, pedido do dono; Paper,
 * página "Pedidos pendentes · seguir conversando"): no lugar do cartão, uma LINHA cinza compacta — o pedido, "· você seguiu
 * sem …" e, à direita, o caminho para refazer. É a mesma âncora do cartão encolhido (`turnoDoEncolhido`): a última fala do
 * turno que pediu. Vale para o recibo `pedido_dispensado` e para a aprovação substituída (ADR-184), que fica "não pago".
 * null = o recibo não é desses (segue o cartão encolhido de sempre).
 */
export type LinhaDispensada = { decisaoId: string; icone: "ponto" | "app" | "pagamento"; titulo: string; sufixo: string; acao: string; slug?: string };

/** "Pagar R$ 249,90 na loja" → "não pago": o particípio do verbo do pedido; sem verbo conhecido, "nada rodou". */
const NAO_FEITO: Readonly<Record<string, string>> = { pagar: "não pago", apagar: "não apagado", excluir: "não excluído", enviar: "não enviado", mandar: "não enviado", publicar: "não publicado", comprar: "não comprado", rodar: "não rodou", executar: "não rodou", criar: "não criado", gravar: "não gravado", salvar: "não salvo", atualizar: "não atualizado", agendar: "não agendado", mover: "não movido", transferir: "não transferido" };

export function naoFeito(titulo: string): string {
  const verbo = titulo.trim().split(/\s+/u)[0]?.toLocaleLowerCase("pt-BR") ?? "";
  return NAO_FEITO[verbo] ?? "nada rodou";
}

const maiusculaInicial = (s: string): string => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);

/** "Pedir de novo": manda ao bot uma mensagem curta pelo campo (a rota de sempre, conversas.enviar). */
function pedirDeNovo(decisaoId: string, frase: string): string {
  return botao("pedir-de-novo", "Pedir de novo", { classe: "pd-acao", id: decisaoId, dados: { texto: `Pode pedir de novo: ${minusculaDaFrase(frase)}` } });
}

const minusculaDaFrase = (s: string): string => s.charAt(0).toLocaleLowerCase("pt-BR") + s.slice(1);

export function linhaDispensada(m: Mensagem, estado: Estado): LinhaDispensada | null {
  const p = m.payload;
  if (p?.kind === "resultado_aprovacao" && p.substituida) {
    const titulo = fraseCurta(p.frase ?? p.itens[0]?.texto ?? "O pedido");
    return { decisaoId: p.decisaoId, icone: "pagamento", titulo: maiusculaInicial(titulo), sufixo: naoFeito(titulo), acao: pedirDeNovo(p.decisaoId, titulo) };
  }
  if (p?.kind !== "pedido_dispensado") return null;
  if (p.ajuda) {
    // O "Fazer agora" é o "Abrir computador" do cartão da ajuda: a tela do bot, já no controle da pessoa.
    return { decisaoId: p.decisaoId, icone: "ponto", titulo: maiusculaInicial(p.frase), sufixo: "você seguiu sem entrar", acao: botao("abrir-computador", "Fazer agora", { classe: "pd-acao", id: p.agenteId, dados: { assumir: "1" } }) };
  }
  if (p.conector) {
    const nome = nomeDoApp(estado, p.conector);
    const pronto = conectorDoApp(estado, p.conector)?.habilitado === true;
    // O card de conexão: "Conectar" abre o login de sempre (conectar-app); com o app já conectado, pede de novo ao bot.
    if (p.conectar) return { decisaoId: p.decisaoId, icone: "app", slug: p.conector, titulo: `Conectar o ${nome}`, sufixo: "você seguiu sem conectar", acao: pronto ? pedirDeNovo(p.decisaoId, `conectar o ${nome}`) : botao("conectar-app", "Conectar", { classe: "pd-acao", id: p.conector, aria: `Conectar o ${nome}` }) };
    return { decisaoId: p.decisaoId, icone: "app", slug: p.conector, titulo: maiusculaInicial(p.frase), sufixo: "você seguiu sem responder", acao: pedirDeNovo(p.decisaoId, p.frase) };
  }
  return { decisaoId: p.decisaoId, icone: "ponto", titulo: maiusculaInicial(p.frase), sufixo: "você seguiu sem responder", acao: pedirDeNovo(p.decisaoId, p.frase) };
}

const ICONE_PAGAMENTO = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="M2 6.5h12M4.5 10h2.5"/></svg>';

/** O HTML da linha: o ícone numa coluna fixa de 16 px, o texto (13/18) com o sufixo mais claro e o link azul à direita. */
export function renderLinhaDispensada(l: LinhaDispensada, mensagemId: string, estado: Estado): string {
  const icone = l.icone === "pagamento" ? ICONE_PAGAMENTO : l.icone === "app" && l.slug ? logoApp(estado, l.slug, l.titulo.replace(/^Conectar o /u, "")) : '<span class="pd-ponto" aria-hidden="true"></span>';
  const titulo = `pd-t-${esc(mensagemId)}`;
  return `<div class="pedido-dispensado" role="group" aria-labelledby="${titulo}" data-pedido-dispensado="${esc(l.decisaoId)}" data-cartao-encolhido="${esc(l.decisaoId)}" data-anuncio="${esc(`${l.titulo}: ${l.sufixo}`)}">`
    + `<span class="pd-ic">${icone}</span>`
    + `<span class="pd-texto" id="${titulo}" tabindex="-1">${esc(l.titulo)} <span class="pd-sufixo">· ${esc(l.sufixo)}</span></span>`
    + l.acao
    + "</div>";
}
