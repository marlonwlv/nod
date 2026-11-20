import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CorAgente, FormaAgente } from "../../../src/contracts/agente.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE, NOME_DA_COR, NOME_DA_FORMA, type EstadoMascote } from "../../lib/mascote.ts";
import { subtituloDoPreparo, type EstadoPreparo } from "../../lib/preparo.ts";
import { APPS, FUNCOES, ORIGENS, PASSOS, nomeDoBot, passoAtual, personagemDoPasso, type EstadoApresentacao } from "../../telas/apresentacao.ts";
import { CORES_DO_SELETOR, FORMAS_DO_SELETOR, NOME_MAX, estadoDoPreparo } from "../../telas/criar-bot.ts";
import { Mascote, Svg } from "./pecas.tsx";
import type { Executar } from "./tipos.ts";

/**
 * ADR-179 (fase 5): o onboarding em 10 passos (ADR-174, tela 13 do Paper) — boas-vindas, conhecer, "tem o próprio
 * computador", dar um trabalho, delegar, função, como conheceu, conectar apps, criar o bot e preparando com %. O modelo
 * (passos, sugestões, personagem de cada passo) é o de web/telas/apresentacao.ts; o controlador guarda o passo e roda o
 * preparo. As animações (cena do computador, desfile, órbita do preparo) são o CSS de sempre, com prefers-reduced-motion.
 *
 * Diferente do desenho por string: o nome e a primeira mensagem ficam no próprio campo (estado do componente) e só são
 * avisados ao controlador, sem redesenhar o app a cada tecla; e o React não recria o personagem quando a barra anda.
 */
const NOD = { nome: "nod", cor: "c-black" as CorAgente, forma: "shape-pebble" as FormaAgente };
const SETA = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const tracoApp = (d: string): string => `<svg class="ap-app-ic" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Tela 13 do Paper: o ícone de traço de cada app na linha (envelope, agenda, a cerquilha do Slack, o quadro do Linear). */
const ICONE_APP: Record<(typeof APPS)[number]["slug"], string> = {
  gmail: tracoApp('<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5 8 9l5.5-4.5"/>'),
  googlecalendar: tracoApp('<rect x="2.5" y="3" width="11" height="10.5" rx="1.5"/><path d="M2.5 6.5h11M5.5 1.8v2.4M10.5 1.8v2.4"/>'),
  slack: tracoApp('<path d="M6 2.5v11M10 2.5v11M2.5 6h11M2.5 10h11"/>'),
  linear: tracoApp('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/>'),
};

const MARCA_PREPARO: Record<string, string> = {
  feito: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  erro: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  falta: '<span class="cb-ponto" aria-hidden="true"></span>',
};

/** Tela 09 do Paper: as 8 formas e as cores do seletor, nesta ordem, mais a que o bot já usa. */
function comAtual<T extends string>(lista: readonly T[], todas: readonly T[], atual: T): T[] {
  return todas.filter((x) => lista.includes(x) || x === atual).sort((a, b) => (lista.indexOf(a) + 1 || 99) - (lista.indexOf(b) + 1 || 99));
}

/** Os rádios de forma e de cor do passo 9 (o mesmo desenho do diálogo "Criar novo bot"). */
function Seletores({ forma, cor, executar }: { forma: FormaAgente; cor: CorAgente; executar: Executar }) {
  return (
    <>
      <div className="cb-formas" role="radiogroup" aria-label="Forma">
        {comAtual(FORMAS_DO_SELETOR, FORMAS_MASCOTE, forma).map((f) => (
          <button key={f} type="button" className="cb-forma" role="radio" aria-checked={f === forma} tabIndex={f === forma ? 0 : -1} aria-label={NOME_DA_FORMA[f]} title={NOME_DA_FORMA[f]} onClick={() => executar("apres-forma", { forma: f })}>
            <Mascote bot={{ nome: NOME_DA_FORMA[f], cor, forma: f }} tamanho="sm" />
          </button>
        ))}
      </div>
      <div className="cb-cores" role="radiogroup" aria-label="Cor">
        {comAtual(CORES_DO_SELETOR, CORES_MASCOTE, cor).filter((c) => c !== "c-black").map((c) => (
          <button key={c} type="button" className="cb-cor" role="radio" aria-checked={c === cor} tabIndex={c === cor ? 0 : -1} aria-label={NOME_DA_COR[c]} title={NOME_DA_COR[c]} onClick={() => executar("apres-cor", { cor: c })}>
            <span className={`cor-amostra ${c}`} />
          </button>
        ))}
      </div>
    </>
  );
}

/** O preparo: personagem, "Preparando a Lia", subtítulo, barra com %, a lista de passos e, no erro, as duas saídas. */
export function Preparo({ p, bot, executar }: { p: EstadoPreparo; bot: { nome: string; cor: CorAgente; forma: FormaAgente }; executar: Executar }) {
  const tentar = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (p.erro) tentar.current?.focus(); }, [p.erro]);
  return (
    <div className="cb-preparo" data-fim={p.pronto ? "pronto" : p.erro ? "erro" : ""}>
      <div className={`cb-preparo-mascote ${bot.cor}${p.pronto || p.erro ? "" : " orbita"}`}><Mascote bot={bot} tamanho="xl" estado={estadoDoPreparo(p)} /></div>
      <h2 className="cb-preparo-titulo" tabIndex={-1}>{p.pronto ? `${p.nome} está pronto` : `Preparando ${p.nome}`}</h2>
      <p className="cb-preparo-sub" aria-live="polite">{subtituloDoPreparo(p)}</p>
      <div className="cb-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.porcento} aria-label={`Preparo de ${p.nome}`}><span className="cb-barra-cheia" style={{ width: `${p.porcento}%` }} /></div>
      <span className="cb-porcento">{p.porcento}%</span>
      <ol className="cb-passos">
        {p.passos.map((x) => (
          <li key={x.id} className="cb-passo" data-situacao={x.situacao}>
            <span className="cb-marca">{x.situacao === "agora" ? <Mascote bot={bot} tamanho="sm" estado="lendo" /> : <Svg html={MARCA_PREPARO[x.situacao] ?? ""} />}</span>
            <span className="cb-rotulo">{x.rotulo}</span>
            {x.detalhe ? <span className="cb-detalhe">{x.detalhe}</span> : null}
          </li>
        ))}
      </ol>
      {p.erro ? (
        <div className="cb-erro" role="alert">
          <p className="cb-erro-titulo">Se der erro</p>
          <p>{p.erro}</p>
          <div className="cb-erro-acoes"><button ref={tentar} type="button" className="bt pri" onClick={() => executar("apres-tentar")}>Tentar de novo</button><button type="button" className="bt" onClick={() => executar("apres-ver")}>Ver o que houve</button></div>
        </div>
      ) : null}
    </div>
  );
}

function Fichas({ lista, atual, campo, executar }: { lista: readonly string[]; atual: string | null; campo: "funcao" | "origem"; executar: Executar }) {
  return <div className="ap-fichas" role="radiogroup">{lista.map((v) => <button key={v} type="button" className="ap-ficha" role="radio" aria-checked={v === atual} onClick={() => executar("apres-escolher", { campo, valor: v })}>{v}</button>)}</div>;
}

/** A cena do passo 3: uma janela do computador do bot com um cursor que anda e clica. */
function CenaComputador() {
  return <div className="ap-cena-pc" aria-hidden="true"><div className="ap-pc-barra" /><div className="ap-pc-tela"><span className="ap-pc-linha l1" /><span className="ap-pc-linha l2" /><span className="ap-pc-linha l3" /><span className="ap-pc-cursor" /></div></div>;
}

/** O desfile do passo 4: três bots de exemplo, cada um com uma função. */
function Desfile() {
  const bots = [
    { nome: "Cobra faturas", cor: "c-green" as CorAgente, forma: "shape-capsule" as FormaAgente },
    { nome: "Daily do time", cor: "c-blue" as CorAgente, forma: "shape-circle" as FormaAgente },
    { nome: "Triagem de e-mail", cor: "c-purple" as CorAgente, forma: "shape-hex" as FormaAgente },
  ];
  return <div className="ap-desfile">{bots.map((b, i) => <div key={b.nome} className="ap-exemplo" style={{ "--atraso": `${i * 120}ms` } as Record<string, string>}><Mascote bot={b} tamanho="lg" estado={i === 1 ? "lendo" : "disponivel"} /><span>{b.nome}</span></div>)}</div>;
}

/** O quadro do passo 5: A fazer, Fazendo, Feito com bots nos cartões. */
function Quadro() {
  const cartao = (cor: CorAgente, forma: FormaAgente, estado: EstadoMascote = "disponivel") => <span key={`${cor}${forma}`} className="ap-cartao"><Mascote bot={{ nome: "", cor, forma }} tamanho="sm" estado={estado} /><i /></span>;
  return (
    <div className="ap-quadro" aria-hidden="true">
      <div><b>A fazer</b>{cartao("c-purple", "shape-hex")}{cartao("c-blue", "shape-circle")}</div>
      <div><b>Fazendo</b>{cartao("c-orange", "shape-star", "lendo")}</div>
      <div><b>Feito</b>{cartao("c-green", "shape-drop")}{cartao("c-pink", "shape-cloud")}</div>
    </div>
  );
}

function Apps({ e, emailGoogle, executar }: { e: EstadoApresentacao; emailGoogle: boolean; executar: Executar }) {
  return (
    <ul className="ap-apps">
      {APPS.map((a, i) => {
        const feito = e.apps.includes(a.slug);
        const conectando = e.conectando === a.slug;
        return (
          <li key={a.slug} className="ap-app">
            <Svg html={ICONE_APP[a.slug]} />
            <span className="ap-app-nome">{a.nome}</span>
            {emailGoogle && i < 2 && !feito ? <span className="ap-sugerido">Sugerido</span> : null}
            {feito ? <span className="ap-conectado">Conectado</span> : <button type="button" className={`bt${i === 0 ? " pri" : ""}`} aria-busy={conectando || undefined} disabled={conectando} onClick={() => executar("apres-conectar", { slug: a.slug })}>{conectando ? "Conectando…" : "Conectar"}</button>}
          </li>
        );
      })}
    </ul>
  );
}

/** O passo 9: prévia, nome, forma, cor e a primeira mensagem (Enter cria e manda). */
function Criar({ e, executar }: { e: EstadoApresentacao; executar: Executar }) {
  const [nome, setNome] = useState(e.nome);
  const [primeira, setPrimeira] = useState(e.primeira);
  const n = nomeDoBot({ nome }) || "seu bot";
  const pergunta = `O que ${n} deve fazer primeiro?`;
  const criar = (): void => { if (nomeDoBot({ nome })) executar("apres-criar"); };
  const enter = (ev: KeyboardEvent<HTMLElement>): void => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); criar(); } };
  return (
    <>
      <div className="ap-personagem ap-previa"><Mascote bot={{ nome: n, cor: e.cor, forma: e.forma }} tamanho="xxl" /></div>
      <h1 id="ap-titulo" className="ap-titulo-discreto" tabIndex={-1}>Crie o seu bot</h1>
      <input className="ap-nome" data-campo-apres="nome" value={nome} maxLength={NOME_MAX} placeholder="Nome do bot" aria-label="Nome do bot" autoComplete="off" onKeyDown={enter} onChange={(ev) => { setNome(ev.target.value); executar("apres-digitar", { campo: "nome", valor: ev.target.value }); }} />
      <Seletores forma={e.forma} cor={e.cor} executar={executar} />
      <div className="ap-composer">
        <textarea data-campo-apres="primeira" rows={1} maxLength={2000} placeholder={pergunta} aria-label={pergunta} value={primeira} onKeyDown={enter} onChange={(ev) => { setPrimeira(ev.target.value); executar("apres-digitar", { campo: "primeira", valor: ev.target.value }); }} />
        <button type="button" className="ap-enviar" aria-label="Criar e mandar" disabled={!nomeDoBot({ nome })} onClick={criar} dangerouslySetInnerHTML={{ __html: SETA }} />
      </div>
    </>
  );
}

/** O rodapé: os pontinhos de progresso (o atual é um traço) e as ações do passo. */
function Rodape({ passo, children }: { passo: number; children: ReactNode }) {
  return (
    <footer className="ap-rodape">
      <div className="ap-pontos" role="img" aria-label={`Passo ${passo + 1} de ${PASSOS.length}`}>{PASSOS.map((p, i) => <span key={p} className={`ap-ponto${i === passo ? " atual" : ""}`} />)}</div>
      <div className="ap-acoes">{children}</div>
    </footer>
  );
}

/**
 * A camada inteira de um passo. `emailGoogle` liga o "Sugerido" do Google; `ligacao` mostra "Prefiro conversar por voz"
 * na abertura (o caminho da ADR-077).
 */
export function Apresentacao({ e, emailGoogle, ligacao, executar }: { e: EstadoApresentacao; emailGoogle: boolean; ligacao: boolean; executar: Executar }) {
  const p = passoAtual(e);
  const raiz = useRef<HTMLElement | null>(null);
  // O título de cada passo recebe o foco quando o passo muda (o leitor de tela anuncia a tela nova).
  const primeiro = useRef(true);
  useEffect(() => {
    if (primeiro.current) { primeiro.current = false; return; }
    raiz.current?.querySelector<HTMLElement>("#ap-titulo, .cb-preparo-titulo")?.focus();
  }, [p]);
  const seguir = (rotulo = "Continuar", desligado = false) => <button type="button" className="bt pri ap-seguir" disabled={desligado} onClick={() => executar("apres-seguir")}>{rotulo}</button>;
  const pular = (rotulo = "Pular") => <button type="button" className="bt link ap-pular" onClick={() => executar("apres-pular")}>{rotulo}</button>;
  const podeSeguir = !(p === "funcao" && !e.funcao) && !(p === "origem" && !e.origem) && p !== "criar";
  // ← → andam pelos passos fora dos campos e dos rádios (como no protótipo).
  const teclas = (ev: KeyboardEvent<HTMLElement>): void => {
    const alvo = ev.target as HTMLElement;
    if (alvo.matches("input, textarea, [role=radio]") || p === "preparando") return;
    if (ev.key === "ArrowRight" && podeSeguir) { ev.preventDefault(); executar("apres-seguir"); }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); executar("apres-voltar"); }
  };
  if (p === "boas-vindas") {
    return (
      <div className="ap-camada">
        <section ref={raiz} className="ap ap-boas-vindas" aria-labelledby="ap-titulo" onKeyDown={teclas}>
          <div className="ap-marca"><Mascote bot={NOD} tamanho="lg" /><h1 id="ap-titulo" tabIndex={-1}>nod</h1></div>
          <p className="ap-sub">Sua equipe de bots, sempre ligada, para quem você dá trabalho de verdade.</p>
          <button type="button" className="bt pri ap-entrar" onClick={() => executar("apres-seguir")}>Entrar <Svg html={SETA} /></button>
          {ligacao ? <button type="button" className="bt link ap-voz" onClick={() => executar("apres-ligacao")}>Prefiro conversar por voz</button> : null}
          <p className="ap-termos">Ao usar o nod, você concorda com os Termos.</p>
        </section>
      </div>
    );
  }
  const personagem = (tamanho: "lg" | "xl" | "xxl" = "xl") => <div className="ap-personagem"><Mascote bot={NOD} tamanho={tamanho} estado={personagemDoPasso(e)} /></div>;
  const bot = { nome: nomeDoBot(e) || "seu bot", cor: e.cor, forma: e.forma };
  let corpo: ReactNode = null;
  let acoes: ReactNode = seguir();
  switch (p) {
    case "conhecer":
      corpo = <>{personagem("xxl")}<h1 id="ap-titulo" tabIndex={-1}>Este é o nod</h1><p className="ap-sub">Ele ouve, pensa e faz. Você aprova o que sai daqui.</p></>;
      break;
    case "computador":
      corpo = <><CenaComputador /><h1 id="ap-titulo" tabIndex={-1}>Ele tem o próprio computador</h1><p className="ap-sub">Roda no seu Mac, numa VM sua ou numa VM do nod.</p></>;
      break;
    case "trabalho":
      corpo = <><Desfile /><h1 id="ap-titulo" tabIndex={-1}>Dê um trabalho a cada bot</h1><p className="ap-sub">Um bot, uma função. Eles se ajudam entre si.</p></>;
      break;
    case "delegar":
      corpo = <><Quadro /><h1 id="ap-titulo" tabIndex={-1}>Passe qualquer tarefa ao seu time</h1><p className="ap-sub">O quadro mostra quem está com o quê.</p></>;
      break;
    case "funcao":
      // Tela 13 do Paper: os passos 6, 7 e 8 não têm o personagem (só a pergunta e as fichas).
      corpo = <><h1 id="ap-titulo" tabIndex={-1}>No que você mais vai trabalhar?</h1><p className="ap-sub">Sugerimos bots para começar.</p><Fichas lista={FUNCOES} atual={e.funcao} campo="funcao" executar={executar} /></>;
      acoes = <>{pular()}{seguir("Continuar", !e.funcao)}</>;
      break;
    case "origem":
      corpo = <><h1 id="ap-titulo" tabIndex={-1}>Como você conheceu o nod?</h1><Fichas lista={ORIGENS} atual={e.origem} campo="origem" executar={executar} /></>;
      acoes = <>{pular()}{seguir("Continuar", !e.origem)}</>;
      break;
    case "apps":
      corpo = <><h1 id="ap-titulo" tabIndex={-1}>Conecte seus apps</h1><p className="ap-sub">{emailGoogle ? "Vimos que seu e-mail é Google." : "O bot só vê o que você liberar."}</p><Apps e={e} emailGoogle={emailGoogle} executar={executar} /></>;
      acoes = e.apps.length ? seguir() : pular("Agora não");
      break;
    case "criar":
      corpo = <Criar e={e} executar={executar} />;
      acoes = null;
      break;
    case "preparando":
      corpo = e.preparo ? <Preparo p={e.preparo} bot={bot} executar={executar} /> : null;
      acoes = null;
      break;
  }
  return (
    <div className="ap-camada">
      <section ref={raiz} className={`ap ap-${p}`} aria-labelledby="ap-titulo" onKeyDown={teclas}>
        {e.passo > 0 && p !== "preparando" ? <button type="button" className="ap-voltar" aria-label="Voltar" onClick={() => executar("apres-voltar")}>‹</button> : null}
        <div className="ap-palco" data-passo={p}>{corpo}</div>
        <Rodape passo={e.passo}>{acoes}</Rodape>
      </section>
    </div>
  );
}
