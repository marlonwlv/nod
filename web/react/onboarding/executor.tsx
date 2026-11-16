import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import { desteMac, nesteMac, terminalDaqui } from "../../lib/plataforma-da-tela.ts";
import { LOGOS_IA } from "../../telas/onboarding-logos.ts";
import { IAS_MAC, PROVEDOR, vistaDaIa, type ContextoCartao, type UiIas } from "../../telas/cartao-ia.ts";
import {
  CARDS_IA, DEPOIS_EM_AJUSTES, EMPRESA_IA, ICONE_OB, LOGO_IA, NOME_CLI, NOME_IA, ORDEM_IAS, SEM_SENHA, comIa, estadoDoCardIa, iaQueRespondeu, nomeDaGuia, passosDaConexao, perguntaDoTeste, telaDaIa,
  type ConexaoIa, type EstadoCardIa, type EstadoTelaOnboarding, type ProvedorIa, type TesteNaTela,
} from "../../telas/onboarding.ts";
import { BotaoCopiar, CartaoIa, LogoIa, type AcoesDoCartaoIa } from "./cartao-ia.tsx";
import { Gira, Girando, Svg } from "./pecas.tsx";
import type { Executar } from "./tipos.ts";

/**
 * ADR-179 (fase 5): a etapa "A IA dos seus bots" (ADR-077, protótipos de 2026-10-05 e a tela 5 do plano das IAs). As
 * decisões de cada tela são as de web/telas/onboarding.ts (`telaDaIa`, `estadoDoCardIa`, `passosDaConexao`); aqui só o
 * desenho e os cliques.
 */
type TelaExecutor = Pick<EstadoTelaOnboarding, "dados" | "procurando" | "iaEntrando" | "notaIa" | "teste" | "iasMac">;
type Props = { e: TelaExecutor; executar: Executar; copiar: (t: string) => Promise<boolean>; cartao: AcoesDoCartaoIa };

function Cabeca({ titulo, texto }: { titulo: string; texto: string }) {
  return <div className="ob-cabeca"><h1 tabIndex={-1}>{titulo}</h1><p>{texto}</p></div>;
}

/** A pergunta do nod e a resposta da IA (os três pontinhos enquanto ela não vem). */
function Prova({ nome, nomeIa, resposta }: { nome: string | null; nomeIa: string; resposta: string | null }) {
  return (
    <div className="ob-prova">
      <div className="ob-prova-linha"><span className="ob-prova-quem">nod</span><span>{perguntaDoTeste(nome)}</span></div>
      <div className="ob-prova-linha"><span className="ob-prova-quem">{nomeIa}</span>{resposta === null ? <span className="ob-pontos" role="img" aria-label="Esperando a resposta"><i /><i /><i /></span> : <b>{resposta}</b>}</div>
    </div>
  );
}

function CardIa({ p, s, nome, menor = false, executar, copiar }: { p: ProvedorIa & { ia: IaDesktop }; s: EstadoCardIa; nome: string | null; menor?: boolean; executar: Executar; copiar: (t: string) => Promise<boolean> }) {
  // O "Conectado" sem a pílula verde ao lado leva o ícone: a frase não fica só na cor.
  const marca = s.tom === "aviso" ? ICONE_OB.aviso : s.tom === "ok" && !s.acao ? ICONE_OB.certo : "";
  const classe = `ob-pilula${s.tom === "ok" ? " ok" : ""}${s.situacao === "desatualizado" ? " aviso" : ""}${menor ? " contorno" : ""}`;
  const act = s.act;
  const lado = s.acao
    ? <button type="button" className={classe} disabled={!act} onClick={act ? () => executar(act, { ia: p.ia }) : undefined}>{s.girando ? <Gira /> : null}{s.acao}</button>
    : s.girando ? <Girando rotulo={s.situacao === "procurando" ? "Procurando" : "Testando"} /> : null;
  const prova = s.situacao === "testando" ? <Prova nome={nome} nomeIa={p.nome} resposta={null} /> : s.resposta && !menor ? <Prova nome={nome} nomeIa={p.nome} resposta={s.resposta} /> : null;
  const explica = s.explicacao && !menor
    ? <div className="ob-ia-explica"><p>{s.explicacao}</p><button type="button" className="ob-link" onClick={() => executar("onboarding-ia-como-liberar", { ia: p.ia })}>Como liberar</button></div>
    : s.comando && !menor
      ? (
        // NOD-171: "Atualizar" abre a página oficial; o comando fica à mão com "Copiar". O nod não roda nada no Terminal.
        <div className="ob-ia-explica ob-ia-atualizar">
          <p>“Atualizar” abre a página oficial do {NOME_CLI[p.ia]} no navegador. {terminalDaqui()}, rode:</p>
          <div className="ob-comando"><code>{s.comando}</code><BotaoCopiar texto={s.comando} copiar={copiar} /></div>
          <p>O nod percebe sozinho quando a versão nova estiver instalada.</p>
        </div>
      )
      : null;
  return (
    <div className={`ob-card-ia${s.tom === "aviso" && !menor ? " aviso" : ""}${menor ? " menor" : ""}`}>
      <div className="ob-ia-linha">
        <Svg html={LOGOS_IA[p.id]} className="ob-logo" />
        <div className="ob-ia-txt"><b>{p.nome}</b><span className={s.tom === "mudo" ? undefined : s.tom} role="status">{marca ? <Svg html={marca} /> : null}{s.estado}</span></div>
        {lado}
      </div>
      {prova}
      {explica}
    </div>
  );
}

function Breves() {
  return <div className="ob-breves">{CARDS_IA.filter((p) => !comIa(p)).map((p) => <div key={p.id} className="ob-breve" aria-disabled="true"><Svg html={LOGOS_IA[p.id]} className="ob-breve-logo" /><b>{p.nome}</b><span>Em breve</span></div>)}</div>;
}

/** "A IA dos seus bots" enquanto o teste roda e "Falta conectar uma IA" quando nenhuma respondeu. */
function ListaDeIas({ e, t, tela, executar, copiar }: Omit<Props, "cartao"> & { t: TesteNaTela; tela: "testando" | "sem_ia" }) {
  const guia = nomeDaGuia(e.dados);
  const reprovada = ORDEM_IAS.some((ia) => { const causa = t.vereditos[ia]?.causa; return causa !== undefined && causa !== "sonda_lenta"; });
  const titulo = tela === "testando" ? "A IA dos seus bots" : "Falta conectar uma IA";
  const texto = tela === "testando"
    ? `Seus bots trabalham com a conta que você já assina, aqui ${nesteMac()}. Estou testando cada uma com uma pergunta curta.`
    : `${reprovada ? `Testei as IAs ${desteMac()} e nenhuma respondeu.` : `Não achei uma IA conectada ${nesteMac()}.`} Conecte uma e o ${guia} te liga em seguida.`;
  const nota = e.notaIa ?? (tela === "testando" ? `${SEM_SENHA} O teste gasta uma resposta curta da sua assinatura.` : `${SEM_SENHA} ${DEPOIS_EM_AJUSTES}`);
  return (
    <section className="ob-tela ob-executor" aria-label={titulo}>
      <Cabeca titulo={titulo} texto={texto} />
      <div className="ob-cards-ia largo">
        {CARDS_IA.filter(comIa).map((p) => <CardIa key={p.id} p={p} s={estadoDoCardIa(p.ia, e.dados.executor.ias, e.iaEntrando, t)} nome={t.nome} executar={executar} copiar={copiar} />)}
        <Breves />
      </div>
      <p className="ob-nota" role="status">{nota}</p>
    </section>
  );
}

/** "Conectando o {provedor}": os três passos, com o que é da pessoa e o que o nod faz sozinho. */
function Conectando({ e, t, c, executar }: { e: TelaExecutor; t: TesteNaTela; c: ConexaoIa; executar: Executar }) {
  const nome = NOME_IA[c.ia];
  const passos = passosDaConexao(c, e.dados.executor.ias.find((i) => i.id === c.ia), t.testando.includes(c.ia));
  const comVoce = passos[0]?.estado === "feito" ? "O do meio é com você, no navegador." : "Os dois primeiros são com você.";
  const titulo = `Conectando o ${nome}`;
  return (
    <section className="ob-tela ob-executor" aria-label={titulo}>
      <Cabeca titulo={titulo} texto={`São três passos. ${comVoce}`} />
      <div className="ob-conexao">
        <div className="ob-ia-linha">
          <Svg html={LOGOS_IA[LOGO_IA[c.ia]]} className="ob-logo" />
          <div className="ob-ia-txt"><b>{nome}</b><span>Pelo {NOME_CLI[c.ia]}, com a sua conta do {nome}</span></div>
          <button type="button" className="ob-pilula contorno" onClick={() => executar("onboarding-ia-cancelar")}>Cancelar</button>
        </div>
        <ol className="ob-passos" aria-live="polite">
          {passos.map((p, i) => (
            <li key={p.id} className={`ob-passo ${p.estado}`} aria-current={p.estado === "ativo" ? "step" : undefined}>
              {p.estado === "feito"
                ? <span className="ob-passo-marca feito"><Svg html={ICONE_OB.certo} /><span className="sr-only">Feito:</span></span>
                : p.estado === "ativo" ? <Girando rotulo="Em andamento" classe="passo" /> : <span className="ob-passo-marca" aria-hidden="true">{i + 1}</span>}
              <div className="ob-passo-txt">
                <b>{p.titulo}</b><span>{p.texto}</span>
                {p.acoes.length ? <div className="ob-passo-acoes">{p.acoes.map((a) => <button key={a.act} type="button" className="ob-link" onClick={() => executar(a.act, { ia: c.ia })}>{a.rotulo}{a.fora ? <Svg html={ICONE_OB.abrir} /> : null}</button>)}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <p className="ob-nota">O nod nunca vê sua senha nem sua chave: o login acontece direto com a {EMPRESA_IA[c.ia]}.</p>
    </section>
  );
}

/** "Seus bots já têm uma IA": a pergunta e a resposta de verdade, o Continuar e o outro provedor como está. */
function Conectada({ e, t, ia, executar, copiar }: Omit<Props, "cartao"> & { t: TesteNaTela; ia: IaDesktop }) {
  const guia = nomeDaGuia(e.dados);
  const nome = NOME_IA[ia];
  // Nesta tela o "Conectado" é a frase com o ícone, sem a pílula verde: o único botão cheio é o Continuar.
  const cards = CARDS_IA.filter(comIa).map((p) => {
    const s = estadoDoCardIa(p.ia, e.dados.executor.ias, e.iaEntrando, t);
    return { p, s: s.situacao === "pronto" ? { ...s, acao: null } : s };
  });
  const principal = cards.find((c) => c.p.ia === ia);
  const respondeu = principal?.s.resposta ? "respondeu ao teste" : "está conectado";
  const titulo = "Seus bots já têm uma IA";
  return (
    <section className="ob-tela ob-executor" aria-label={titulo}>
      <Cabeca titulo={titulo} texto={`O ${nome} ${respondeu} ${nesteMac()}. O ${guia} vai te ligar para montar o seu primeiro bot.`} />
      <div className="ob-cards-ia largo">
        {principal ? <CardIa p={principal.p} s={principal.s} nome={t.nome} executar={executar} copiar={copiar} /> : null}
        {cards.filter((c) => c.p.ia !== ia).map((c) => <CardIa key={c.p.id} p={c.p} s={c.s} nome={t.nome} menor executar={executar} copiar={copiar} />)}
      </div>
      <div className="ob-seguir">
        <button type="button" className="ob-pilula grande" disabled={t.seguindo} onClick={() => executar("onboarding-ia-continuar")}>{t.seguindo ? <Gira /> : null}Continuar</button>
        <p className="ob-nota" role="status">{e.notaIa ?? DEPOIS_EM_AJUSTES}</p>
      </div>
    </section>
  );
}

/**
 * Tela 5 do plano das IAs (protótipo Onboarding, 2026-10-09): dentro do app do Mac com a ponte `ias`, a etapa é a lista
 * de cartões de Provedores de IA; o teste de uma frase continua sendo o do onboarding (onboarding-teste.ts).
 */
function ExecutorNoApp({ e, t, ui, executar, cartao }: { e: TelaExecutor; t: TesteNaTela; ui: UiIas; executar: Executar; cartao: AcoesDoCartaoIa }) {
  const vereditos = Object.fromEntries(Object.entries(t.vereditos).map(([ia, v]) => [ia, { estado: v.estado, ...(v.causa ? { causa: v.causa } : {}), ...(v.resposta ? { resposta: v.resposta } : {}) }]));
  // O teste do "olá" ainda roda: a IA logada sem veredito está sendo testada.
  const testando = IAS_MAC.filter((ia) => t.testando.includes(ia) || (t.rodando && !t.vereditos[ia] && ui.estados[ia]?.estado === "pronta"));
  const c: ContextoCartao = { servidor: null, ui, agora: Date.now(), onde: "onboarding", vereditos, testandoNoOnboarding: testando };
  const prontas = ORDEM_IAS.filter((ia) => t.vereditos[ia]?.estado === "pronto");
  const procurando = IAS_MAC.every((ia) => !ui.estados[ia] || ui.estados[ia]?.estado === "procurando");
  const titulo = prontas.length ? "Seus bots já têm uma IA" : "A IA dos seus bots";
  const cabeca = <Cabeca titulo={titulo} texto={`Seus bots trabalham com a conta que você já assina, aqui ${nesteMac()}. O nod nunca vê sua senha.`} />;
  if (procurando) return <section className="ob-tela ob-executor" aria-label={titulo}>{cabeca}<div className="ob-procurando" role="status"><Gira />Procurando o Claude e o ChatGPT {nesteMac()}…</div><p className="ob-nota" /></section>;
  const [primeira, segunda] = prontas;
  const rotulo = prontas.length === 1 && primeira ? `Continuar com o ${NOME_IA[primeira]}` : "Continuar";
  // NOD-209: enquanto a pessoa entra com a outra conta, a IA fica fora do Continuar (cancelar volta para a de agora).
  const trocando = IAS_MAC.find((ia) => ui.troca[ia]?.fase === "abrindo" || ui.troca[ia]?.fase === "entrando");
  const nota = e.notaIa ?? (trocando
    ? `Enquanto você troca, o ${NOME_IA[trocando]} fica de fora. Cancelar volta para a conta atual.`
    : prontas.length === 0
      ? "Conecte pelo menos uma IA para seus bots começarem."
      : prontas.length === 1 ? "Dica: conecte as duas. Se uma chegar ao limite, a outra assume. Dá para fazer depois em Provedores de IA." : "Dá para trocar a conta ou a ordem depois em Provedores de IA.");
  return (
    <section className="ob-tela ob-executor" aria-label={titulo}>
      {cabeca}
      <div className="ob-cards-ia largo">
        {ORDEM_IAS.map((ia) => {
          const v = vistaDaIa(ia, c);
          return <div key={ia} className={`ob-card-ia${v.passos ? " aberto" : ""}${v.tom === "aviso" ? " aviso" : ""}`}><CartaoIa v={v} ui={ui} acoes={cartao} /></div>;
        })}
      </div>
      <div className="ob-seguir">
        {primeira && segunda ? <div className="ordem-final"><span>Seus bots usam</span><LogoIa ia={primeira} /><b>{PROVEDOR[primeira].nome}</b><span>e, se ele parar,</span><LogoIa ia={segunda} /><b>{PROVEDOR[segunda].nome}</b></div> : null}
        <button type="button" className="ob-pilula grande" disabled={prontas.length === 0 || t.seguindo} onClick={() => executar("onboarding-ia-continuar")}>{t.seguindo ? <Gira /> : null}{rotulo}</button>
        <p className="ob-nota" role="status">{nota}</p>
      </div>
    </section>
  );
}

/**
 * A etapa inteira. Com teste (dentro do app do Mac): testando, "Falta conectar uma IA", os três passos ou "Seus bots já
 * têm uma IA". Sem teste (navegador comum ou app antigo): os quatro cards de sempre, com o que o servidor diz de cada IA.
 */
export function Executor({ e, executar, copiar, cartao }: Props) {
  const t = e.teste;
  if (t && e.iasMac?.noApp) return <ExecutorNoApp e={e} t={t} ui={e.iasMac} executar={executar} cartao={cartao} />;
  if (t) {
    const tela = telaDaIa(t);
    const pronta = iaQueRespondeu(t.vereditos);
    if (tela === "conectando" && t.conexao) return <Conectando e={e} t={t} c={t.conexao} executar={executar} />;
    if (tela === "conectada" && pronta) return <Conectada e={e} t={t} ia={pronta} executar={executar} copiar={copiar} />;
    return <ListaDeIas e={e} t={t} tela={tela === "testando" ? "testando" : "sem_ia"} executar={executar} copiar={copiar} />;
  }
  const cabeca = <div className="ob-cabeca"><h1>A IA dos seus bots</h1><p>Seus bots trabalham com a conta que você já assina, aqui {nesteMac()}. O nod nunca vê sua senha nem sua chave.</p></div>;
  if (e.procurando) return <section className="ob-tela ob-executor" aria-label="A IA dos seus bots">{cabeca}<div className="ob-procurando" role="status"><Gira />Procurando o Claude Code e o Codex {nesteMac()}…</div><p className="ob-nota" /></section>;
  return (
    <section className="ob-tela ob-executor" aria-label="A IA dos seus bots">
      {cabeca}
      <div className="ob-cards-ia">
        {CARDS_IA.map((p) => comIa(p)
          ? <CardIa key={p.id} p={p} s={estadoDoCardIa(p.ia, e.dados.executor.ias, e.iaEntrando)} nome={null} executar={executar} copiar={copiar} />
          : <div key={p.id} className="ob-card-ia em-breve" aria-disabled="true"><div className="ob-ia-linha"><Svg html={LOGOS_IA[p.id]} className="ob-logo" /><div className="ob-ia-txt"><b>{p.nome}</b><span>Em breve</span></div></div></div>)}
      </div>
      <p className="ob-nota" role="status">{e.notaIa ?? "Dá para trocar ou adicionar outra depois, em Seu espaço › Provedores de IA."}</p>
    </section>
  );
}
