import { useEffect, useRef, useState, type FormEvent } from "react";
import { COPIADO_MS, ROTULO_COPIADO, ROTULO_NAO_COPIOU } from "../../lib/copiar.ts";
import { terminalDaqui } from "../../lib/plataforma-da-tela.ts";
import { LOGOS_IA } from "../../telas/onboarding-logos.ts";
import { AJUDA_IA, ICONE_IA, PROVEDOR, type AcaoIa, type IaMac, type IdPasso, type PassoIa, type UiIas, type VistaIa } from "../../telas/cartao-ia.ts";
import { Gira, Svg } from "./pecas.tsx";

/**
 * ADR-179 (fase 5): o cartão de uma IA (web/telas/cartao-ia.ts, `renderCartaoIa`) como componente, para a etapa "A IA
 * dos seus bots" do onboarding. A vista (`vistaDaIa`) é a mesma função pura de Provedores de IA; só o desenho mudou de
 * motor. Os cliques chegam ao main.ts por `acoes` (o mesmo `iasDoMac` dos `data-act="ia-…"` de Provedores de IA).
 */
export type AcoesDoCartaoIa = {
  agir: (act: AcaoIa, ia: IaMac, extra?: { agora?: boolean; passo?: IdPasso; texto?: string }) => void;
  /** O código do Claude que a pessoa digita: mora em `estado.iasMac.codigo` e atravessa o redesenho. */
  digitarCodigo: (ia: IaMac, codigo: string) => void;
  colarCodigo: (ia: IaMac, codigo: string) => void;
  copiar: (texto: string) => Promise<boolean>;
};

export function LogoIa({ ia, classe = "ob-logo" }: { ia: IaMac; classe?: string }) {
  return <Svg html={LOGOS_IA[PROVEDOR[ia].logo]} className={classe} data-logo-ia={PROVEDOR[ia].logo} aria-hidden="true" />;
}

/** NOD-8: "✓ Copiado" (ou "Não copiou") por 2 s e volta; o botão é região viva, para o leitor de tela ouvir. */
export function BotaoCopiar({ texto, copiar, classe = "ob-link", rotulo = "Copiar", copiadoFora = false }: { texto: string; copiar: (t: string) => Promise<boolean>; classe?: string; rotulo?: string; copiadoFora?: boolean }) {
  const [resultado, setResultado] = useState<"copiado" | "falhou" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const clicar = async (): Promise<void> => {
    const ok = await copiar(texto);
    window.clearTimeout(timer.current);
    setResultado(ok ? "copiado" : "falhou");
    timer.current = window.setTimeout(() => setResultado(null), COPIADO_MS);
  };
  const mostra = copiadoFora || resultado === "copiado" ? ROTULO_COPIADO : resultado === "falhou" ? ROTULO_NAO_COPIOU : rotulo;
  return <button type="button" className={`${classe} rx-copiar`} aria-live="polite" onClick={() => void clicar()}>{mostra}</button>;
}

function MarcaDoPasso({ p, n }: { p: PassoIa; n: number }) {
  if (p.marca === "feito") return <span className="ia-passo-marca feito"><Svg html={ICONE_IA.certo} /><span className="sr-only">Feito:</span></span>;
  if (p.marca === "erro") return <span className="ia-passo-marca falha" aria-hidden="true">!</span>;
  if (p.marca === "girando") return <span className="ia-passo-marca"><span className="ob-gira" role="img" aria-label="Em andamento" /></span>;
  return <span className={`ia-passo-marca${p.marca === "ativo" ? " ativo" : ""}`} aria-hidden="true">{n}</span>;
}

function FormColar({ v, ui, acoes }: { v: VistaIa; ui: UiIas; acoes: AcoesDoCartaoIa }) {
  const empresa = PROVEDOR[v.ia].empresa;
  const valor = ui.codigo[v.ia] ?? "";
  const enviar = (ev: FormEvent<HTMLFormElement>): void => {
    ev.preventDefault();
    if (valor.trim()) acoes.colarCodigo(v.ia, valor);
  };
  return (
    <form className="ia-colar" onSubmit={enviar}>
      <input type="text" name="codigo" value={valor} onChange={(e) => acoes.digitarCodigo(v.ia, e.target.value)} autoComplete="off" spellCheck={false} placeholder={`Cole aqui o código que a ${empresa} mostrou`} aria-label={`Código da ${empresa}`} />
      <button type="submit" className="ob-pilula contorno">Confirmar</button>
    </form>
  );
}

function Passo({ v, p, n, ui, acoes }: { v: VistaIa; p: PassoIa; n: number; ui: UiIas; acoes: AcoesDoCartaoIa }) {
  const empresa = PROVEDOR[v.ia].empresa;
  const comAjuda = p.marca === "ativo" || p.marca === "girando" || p.marca === "erro";
  const aberta = ui.ajuda === `${v.ia}:${p.id}`;
  const ajuda = AJUDA_IA[v.ia][p.id];
  return (
    <li className={`ia-passo${p.marca === "depois" ? " depois" : ""}`} aria-current={p.marca === "ativo" || p.marca === "girando" ? "step" : undefined}>
      <MarcaDoPasso p={p} n={n} />
      <div className="ia-passo-txt">
        <b>{p.titulo}</b>
        {p.contaAtual ? <span className="ia-conta-atual">Agora: <b>{p.contaAtual}</b> · continua valendo se você cancelar</span> : null}
        {p.trocou ? (
          p.trocou.antes === p.trocou.agora
            ? <span className="ia-trocou">A conta continua a mesma: <b>{p.trocou.agora}</b>.</span>
            : <span className="ia-trocou">Agora com <b>{p.trocou.agora}</b>.{p.trocou.antes ? ` Antes era ${p.trocou.antes}.` : ""}</span>
        ) : null}
        {p.texto ? <span className={p.marca === "erro" ? "ia-erro-txt" : ""}>{p.texto}</span> : null}
        {p.log ? <span className="ia-log">{p.log}</span> : null}
        {p.codigo ? <div className="ia-codigo"><code>{p.codigo}</code><BotaoCopiar texto={p.codigo} copiadoFora={ui.copiado === v.ia} copiar={async (t) => { acoes.agir("ia-copiar-codigo", v.ia, { texto: t }); return true; }} /></div> : null}
        {p.dica ? <div className="ia-troca-dica"><Svg html={ICONE_IA.aviso} /><p>{p.dica}</p></div> : null}
        {p.abrir || p.esperando ? (
          <div className="ia-acoes">
            {p.abrir ? <button type="button" className="ob-link" onClick={() => acoes.agir("ia-abrir-link", v.ia)}>Abrir a página da {empresa}<Svg html={ICONE_IA.abrir} /></button> : null}
            {p.esperando ? <span className="ia-esperando"><Gira />{p.esperando}</span> : null}
          </div>
        ) : null}
        {p.colar ? <FormColar v={v} ui={ui} acoes={acoes} /> : null}
        {p.acoes.length ? <div className="ia-acoes">{p.acoes.map((a) => <button key={`${a.act}:${a.rotulo}`} type="button" className={a.contorno ? "ob-pilula contorno" : "ob-link"} onClick={() => acoes.agir(a.act, v.ia)}>{a.rotulo}</button>)}</div> : null}
        {p.detalhe ? <span className="ia-log ia-detalhe">{p.detalhe}</span> : null}
        {comAjuda ? <button type="button" className="ia-ajuda-link" aria-expanded={aberta} onClick={() => acoes.agir("ia-ajuda", v.ia, { passo: p.id })}>Precisa de ajuda?</button> : null}
        {comAjuda && aberta ? (
          <div className="ia-ajuda">
            {ajuda.textos.map((t) => <p key={t}>{t}</p>)}
            {ajuda.links.length ? <span className="ia-ajuda-links">{ajuda.links.map((l) => <a key={l.url} className="ob-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.rotulo}<Svg html={ICONE_IA.abrir} /></a>)}</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** A linha (logo, nome, estado e um botão) e, embaixo, o fluxo, a explicação, a nota e o "Prefere o terminal?". */
export function CartaoIa({ v, ui, acoes }: { v: VistaIa; ui: UiIas; acoes: AcoesDoCartaoIa }) {
  const marca = v.tom === "ok" ? ICONE_IA.certo : v.tom === "aviso" ? ICONE_IA.aviso : "";
  return (
    <>
      <div className="ia-linha">
        <LogoIa ia={v.ia} />
        <div className="ob-ia-txt">
          <b>{v.nome}</b>
          <span className={v.tom === "mudo" ? undefined : v.tom} role="status">{marca ? <Svg html={marca} /> : null}{v.texto}</span>
          {v.conta ? <span className="ia-conta" title={v.conta}><Svg html={ICONE_IA.pessoa} /><span className="ia-conta-txt"><span className="sr-only">Conta: </span>{v.conta}</span></span> : null}
        </div>
        {v.girando ? <Gira grande /> : null}
        {v.trocar ? <button type="button" className={v.trocar === "link" ? "ob-link ia-trocar" : "ob-pilula contorno"} aria-label={`Trocar a conta do ${v.nome}`} onClick={() => acoes.agir("ia-trocar", v.ia)}>Trocar conta</button> : null}
        {v.botao ? <button type="button" className={`ob-pilula${v.botao.destaque ? "" : " contorno"}`} onClick={() => acoes.agir(v.botao!.act, v.ia, v.botao!.agora ? { agora: true } : {})}>{v.botao.rotulo}</button> : null}
      </div>
      {v.passos ? <ol className="ia-fluxo" aria-live="polite">{v.passos.map((p, i) => <Passo key={p.id} v={v} p={p} n={i + 1} ui={ui} acoes={acoes} />)}</ol> : null}
      {v.explica ? <div className="ia-explica" role="status"><p>{v.explica}</p></div> : null}
      {v.nota ? <p className="ia-aviso-nota" role="status">{v.nota}</p> : null}
      {v.terminal ? (
        <details className="ia-terminal">
          <summary className="cl-terminal-link">Prefere o terminal?</summary>
          <p className="cl-terminal">{terminalDaqui()}: <code>{v.terminal}</code> <BotaoCopiar texto={v.terminal} copiar={acoes.copiar} /></p>
        </details>
      ) : null}
    </>
  );
}
