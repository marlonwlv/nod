import { useState, type FormEvent } from "react";
import type { EstadoOnboarding } from "../../../src/contracts/onboarding.ts";
import { desteMac } from "../../lib/plataforma-da-tela.ts";
import { LOGOS_IA } from "../../telas/onboarding-logos.ts";
import { ICONE_OB, LOGO_IA, NOME_IA, TEXTO_VOZ_CURTO, iaDaLigacao, linhasContou, nomeDaGuia, textoTudoMontado, type EstadoTelaOnboarding } from "../../telas/onboarding.ts";
import { Gira, Mascote, Svg } from "./pecas.tsx";
import type { Executar } from "./tipos.ts";

/**
 * ADR-179 (fase 5): as camadas do onboarding por ligação (ADR-077) — o "olá" de 3,3 s, "está te ligando", o painel
 * "O que você contou" ao lado da entrevista e a configuração guiada solta (sem a conversa da guia). Os textos e as
 * decisões são os de web/telas/onboarding.ts; os anéis do toque são o CSS de sempre (web/onboarding.css), que já
 * respeita prefers-reduced-motion.
 */

/** A abertura: "olá" grande, que some sozinho em ~3,2 s; um clique pula. Nada toca antes de um clique. */
export function Ola({ executar }: { executar: Executar }) {
  return <button type="button" className="ob-ola" aria-label="Pular abertura" onClick={() => executar("onboarding-pular-ola")}><span>olá</span></button>;
}

export function Chamando({ e, executar }: { e: Pick<EstadoTelaOnboarding, "dados" | "atendendo" | "teste">; executar: Executar }) {
  const nome = nomeDaGuia(e.dados);
  const guia = e.dados.guia;
  // definido em 2026-10-05: a pessoa vê com qual conta dela a guia vai pensar (some quando quem roda é o servidor).
  const ia = iaDaLigacao(e.dados.executor.ias, e.teste?.vereditos);
  return (
    <section className="ob-tela ob-chamando" aria-label={`${nome} está te ligando`}>
      <div className="ob-toque"><span className="ob-anel" /><span className="ob-anel b" /><div className="ob-toque-mascote">{guia ? <Mascote bot={guia} tamanho="xxl" /> : null}</div></div>
      <div className="ob-quem"><b>{nome}</b><span>está te ligando</span></div>
      {ia ? <p className="ob-pensa"><Svg html={LOGOS_IA[LOGO_IA[ia]]} className="ob-pensa-logo" />{nome} vai pensar com o {NOME_IA[ia]} {desteMac()}</p> : null}
      <div className="ob-botoes-ligacao">
        <div className="ob-botao-ligacao"><button type="button" className="ob-redondo" disabled={e.atendendo} onClick={() => executar("onboarding-sem-voz")} dangerouslySetInnerHTML={{ __html: ICONE_OB.semVoz }} /><span>Configurar sem voz</span></div>
        <div className="ob-botao-ligacao">
          <button type="button" className="ob-redondo atender" disabled={e.atendendo} aria-describedby="ob-aviso-voz" onClick={() => executar("onboarding-atender")} dangerouslySetInnerHTML={{ __html: ICONE_OB.atender }} /><span>Atender</span>
          <p className="ob-aviso-voz" id="ob-aviso-voz">{TEXTO_VOZ_CURTO} · <button type="button" className="ob-link" onClick={() => executar("onboarding-saber-mais")}>saber mais</button></p>
        </div>
      </div>
    </section>
  );
}

/** Ao lado da tela cheia da ligação, durante a entrevista (por cima, à direita, sem cobrir os controles). */
export function PainelEntrevista({ dados }: { dados: EstadoOnboarding }) {
  const linhas = linhasContou(dados.campos);
  return (
    <aside className="ob-painel-entrevista" aria-label="O que você contou" aria-live="polite">
      <div className="ob-bloco">
        <h3>O que você contou</h3>
        {linhas.length ? linhas.map((l) => <div key={l.rotulo} className="ob-linha"><span>{l.rotulo}</span><b>{l.valor}</b></div>) : <p className="ob-vazio">Aparece aqui durante a ligação.</p>}
      </div>
    </aside>
  );
}

function CardBot({ d, ocupado, executar }: { d: EstadoOnboarding; ocupado: boolean; executar: Executar }) {
  const p = d.pendentes.bot;
  const m = d.modelo;
  const [nome, setNome] = useState(p?.nome ?? m.nome);
  const [descricao, setDescricao] = useState(p?.descricao ?? m.descricao);
  const enviar = (ev: FormEvent<HTMLFormElement>): void => {
    ev.preventDefault();
    if (!nome.trim()) return;
    executar("onboarding-bot-enviar", { nome: nome.trim(), descricao: descricao.trim(), decisao: p?.decisaoId });
  };
  return (
    <form className="ob-card" onSubmit={enviar}>
      <div className="ob-card-cab"><Mascote bot={{ nome: p?.nome ?? m.nome, forma: p?.forma ?? m.forma, cor: p?.cor ?? m.cor }} tamanho="lg" /><div><span className="ob-sobre">Novo bot · preenchido com o que você contou</span><b className="ob-titulo">{p?.nome ?? m.nome}</b></div></div>
      <label className="ob-campo">Nome<input name="nome" id="ob-bot-nome" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" required /></label>
      <label className="ob-campo">O que ele faz<textarea name="descricao" id="ob-bot-descricao" rows={3} maxLength={600} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
      <div className="ob-card-acoes">
        {p ? <button type="button" className="bt ob-secundario" onClick={() => executar("onboarding-recusar-bot", { id: p.decisaoId })}>Agora não</button> : null}
        <button type="submit" className="ob-pilula" disabled={ocupado}>{ocupado ? <Gira /> : null}Criar bot</button>
      </div>
    </form>
  );
}

function CardApp({ d, e, executar }: { d: EstadoOnboarding; e: Pick<EstadoTelaOnboarding, "appConectando" | "ocupado">; executar: Executar }) {
  const m = d.modelo;
  const pendente = d.pendentes.acesso;
  let acao;
  if (d.appConectado) acao = <span className="ob-conectado">Conectado</span>;
  else if (pendente && !pendente.conectar) acao = <button type="button" className="ob-pilula" disabled={e.ocupado} onClick={() => executar("onboarding-permitir-app", { id: pendente.decisaoId })}>Permitir</button>;
  else acao = <button type="button" className="ob-pilula" disabled={e.appConectando || e.ocupado} onClick={() => executar("onboarding-conectar-app", { slug: m.app.slug })}>{e.appConectando ? <><Gira />Esperando o navegador</> : "Entrar e conectar"}</button>;
  return (
    <div className="ob-card">
      {/* A cor do app vem do servidor (marca de terceiros): única cor fora dos tokens neste card. */}
      <div className="ob-card-cab"><span className="ob-app" style={{ background: m.app.cor }} aria-hidden="true">{m.app.letra}</span><div><span className="ob-sobre">Conectar para o {d.bot?.nome ?? m.nome}</span><b className="ob-titulo">{m.app.nome}</b></div></div>
      <ul className="ob-permissoes">
        {m.pode.map((t) => <li key={t}><span className="ob-sim" aria-hidden="true">✓</span>{t}</li>)}
        <li><span className="ob-nao" aria-hidden="true">×</span>{m.nao}</li>
      </ul>
      <div className="ob-card-acoes">{acao}</div>
    </div>
  );
}

function CardRotina({ d, ocupado, executar }: { d: EstadoOnboarding; ocupado: boolean; executar: Executar }) {
  const m = d.modelo;
  const pendente = d.pendentes.rotina;
  return (
    <div className="ob-card ob-card-rotina">
      <span className="ob-sobre ob-sobre-lista">Rotina do {d.bot?.nome ?? m.nome}</span>
      {pendente ? <div className="ob-rotina proposta"><span className="ob-radio on" aria-hidden="true" /><span className="ob-oque">{pendente.resumo}</span><button type="button" className="bt ob-pilula sm" onClick={() => executar("onboarding-criar-rotina-proposta", { id: pendente.decisaoId })}>Criar rotina</button></div> : null}
      {m.rotinas.map((r, i) => <button key={`${r.oque}:${r.quando}`} type="button" className="ob-rotina" disabled={ocupado} onClick={() => executar("onboarding-escolher-rotina", { indice: String(i) })}><span className="ob-radio" aria-hidden="true" /><span className="ob-oque">{r.oque}</span><span className="ob-quando">{r.quando}</span></button>)}
    </div>
  );
}

/**
 * A configuração guiada sem a conversa da guia: uma camada por cima do app, com a saída "Fazer depois". Na conversa da
 * guia o mesmo bloco continua por string (`htmlGuia`), até a conversa migrar (fase da #timeline).
 */
export function GuiaSolta({ e, executar }: { e: EstadoTelaOnboarding; executar: Executar }) {
  const d = e.dados;
  const nome = nomeDaGuia(d);
  const apelido = d.campos.apelido;
  const abertura = e.emLigacao
    ? `Oi, ${apelido ?? "tudo bem"}. Seguimos na ligação; eu vou montando tudo aqui enquanto a gente conversa.`
    : `Oi${apelido ? `, ${apelido}` : ""}. Vamos montar o seu primeiro bot: são três passos rápidos.`;
  const fim = e.fase === "fim" || d.passo === "fim";
  return (
    <div className="ob-guia-solta">
      <section className="ob-guia" aria-label="Configuração inicial">
        <div className="ob-balao">{abertura}</div>
        {fim
          ? <div className="ob-fim" role="status">{textoTudoMontado(nome)}<button type="button" className="ob-link" onClick={() => executar("onboarding-de-novo")}>Ver o onboarding de novo</button></div>
          : d.passo === "bot" ? <CardBot key={d.pendentes.bot?.decisaoId ?? "modelo"} d={d} ocupado={e.ocupado} executar={executar} />
            : d.passo === "app" ? <CardApp d={d} e={e} executar={executar} />
              : <CardRotina d={d} ocupado={e.ocupado} executar={executar} />}
      </section>
      <button type="button" className="ob-link ob-depois" onClick={() => executar("onboarding-depois")}>Fazer depois</button>
    </div>
  );
}
