import { useState, type FormEvent, type ReactNode } from "react";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import { LOGOS_IA } from "../../telas/onboarding-logos.ts";
import { CABECA_DO_COMPUTADOR, IAS_COMPUTADOR, desatualizadoNoComputador, estadoDaTela, type TelaComputador, type VistaComputador } from "../../telas/este-computador.ts";
import { Svg } from "./pecas.tsx";
import type { Executar } from "./tipos.ts";

/**
 * ADR-179 (fase 5): a tela "Este computador" (ADA-242, protótipo `prancha-a.html` 2a–2g), uma por máquina. Os estados
 * (2a…2g) saem de `estadoDaTela` em web/telas/este-computador.ts, que também guarda o controlador; aqui só o desenho.
 */
const NOME: Record<IaDesktop, string> = { "claude-cli": "Claude", "codex-cli": "ChatGPT" };
const LOGO: Record<IaDesktop, string> = { "claude-cli": LOGOS_IA.claude, "codex-cli": LOGOS_IA.chatgpt };

function Bt({ acao, rotulo, ia, pri = false, ocupado = false, executar }: { acao: string; rotulo: string; ia: IaDesktop | null; pri?: boolean; ocupado?: boolean; executar: Executar }) {
  return <button type="button" className={`bt${pri ? " pri" : ""}`} disabled={ocupado} onClick={() => executar(acao, ia ? { ia } : {})}>{rotulo}</button>;
}

/** O campo do código do Claude no 2f (só com a ponte do Mac que aceita colar). */
function Codigo({ ia, ocupado, executar }: { ia: IaDesktop; ocupado: boolean; executar: Executar }) {
  const [codigo, setCodigo] = useState("");
  const enviar = (ev: FormEvent<HTMLFormElement>): void => { ev.preventDefault(); executar("computador-codigo", { ia, codigo }); };
  return (
    <form className="ec-codigo" onSubmit={enviar}>
      <label className="cc-campo">Se o site do {NOME[ia]} mostrar um código, cole aqui:<input name="codigo" autoComplete="off" spellCheck={false} maxLength={200} required aria-label={`Código do ${NOME[ia]}`} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
      <button type="submit" className="bt" disabled={ocupado}>Enviar ao {NOME[ia]}</button>
    </form>
  );
}

/** Uma linha (Claude ou ChatGPT): o estado em uma frase e o botão do protótipo. */
function Linha({ ia, tela, v, principal, principalPronta, executar }: { ia: IaDesktop; tela: TelaComputador; v: VistaComputador; principal: boolean; principalPronta: boolean; executar: Executar }) {
  const nome = NOME[ia];
  const conta = v.fontes[ia]?.mac?.conta?.email ?? null;
  const o = v.ocupado;
  const secundaria = ia === "codex-cli";
  let estado: string;
  let acao: ReactNode = null;
  switch (tela) {
    case "2a": estado = conta ? `Conectado como ${conta}` : "Conectado"; break;
    case "2b": estado = "Está neste computador; falta entrar."; acao = <Bt acao="computador-entrar" rotulo="Entrar" ia={ia} pri={principal} ocupado={o} executar={executar} />; break;
    case "2c":
      if (desatualizadoNoComputador(v.fontes[ia])) { estado = "Está neste computador, mas desatualizado. O nod atualiza e segue para o login."; acao = <Bt acao="computador-instalar" rotulo="Atualizar e entrar" ia={ia} pri={principal} ocupado={o} executar={executar} />; break; }
      estado = secundaria ? "Também funciona sozinho ou como reserva do Claude." : "Recomendado. Instala em menos de um minuto.";
      acao = <Bt acao="computador-instalar" rotulo="Instalar e entrar" ia={ia} pri={principal && !secundaria} ocupado={o} executar={executar} />;
      break;
    case "instalando": estado = "Instalando…"; break;
    case "2d": {
      const cod = v.fontes[ia]?.mac?.login?.codigoDoDispositivo;
      estado = cod ? `Digite o código ${cod} na página da OpenAI.` : "Esperando o login no navegador…";
      acao = <Bt acao="computador-abrir" rotulo="Abrir de novo" ia={ia} ocupado={o} executar={executar} />;
      break;
    }
    case "2e": estado = `Não consegui baixar o ${nome}. Nada foi alterado no computador.`; acao = <Bt acao="computador-instalar" rotulo="Tentar de novo" ia={ia} pri ocupado={o} executar={executar} />; break;
    case "2f":
      estado = "O login não chegou até aqui.";
      acao = <><Bt acao="computador-abrir" rotulo="Abrir de novo" ia={ia} ocupado={o} executar={executar} /><Bt acao="computador-conferir" rotulo="Conferir de novo" ia={ia} pri ocupado={o} executar={executar} />{v.colarCodigo && ia === "claude-cli" ? <Codigo ia={ia} ocupado={o} executar={executar} /> : null}</>;
      break;
    case "2g": estado = `Conta sem acesso ao ${nome}.${conta ? ` ${conta}` : ""}`; acao = <Bt acao="computador-entrar" rotulo="Entrar com outra conta" ia={ia} pri ocupado={o} executar={executar} />; break;
    default: estado = "Procurando…";
  }
  // Com uma IA pronta, a outra só avisa que dá para ligar depois (protótipo 2a).
  if (!principal && principalPronta && tela !== "2a") { estado = "Dá para ligar depois, em Configurações › Suas IAs. Se o Claude chegar ao limite, ele assume."; acao = null; }
  else if (!principal && tela === "2c") estado = secundaria ? estado : "Não está neste computador.";
  return (
    <div className={`ec-ia${principal ? " principal" : ""}`} data-tela={tela}>
      <Svg html={LOGO[ia]} className="ob-logo" />
      <div className="ec-ia-txt"><b>{nome}</b><span role="status">{estado}</span></div>
      <div className="ec-acoes">{acao}</div>
    </div>
  );
}

/** A tela inteira (camada cheia do onboarding). */
export function EsteComputador({ v, executar }: { v: VistaComputador; executar: Executar }) {
  const { tela, principal, linhas } = estadoDaTela(v.fontes, v.agora, v.emFoco);
  const [titulo, texto] = CABECA_DO_COMPUTADOR[tela](NOME[principal]);
  const ordem = [principal, ...IAS_COMPUTADOR.filter((ia) => ia !== principal)];
  const esperando = tela === "2d" || tela === "2f";
  return (
    <section className="ob-tela ec-tela" aria-label="Este computador" data-estado={tela}>
      <div className="ob-cabeca"><span className="ec-selo">Este computador</span><h1 tabIndex={-1}>{titulo}</h1><p>{texto}</p></div>
      <div className="ec-lista">{ordem.map((ia) => <Linha key={ia} ia={ia} tela={linhas[ia]} v={v} principal={ia === principal} principalPronta={tela === "2a"} executar={executar} />)}</div>
      {v.nota ? <p className="ec-nota" role="alert">{v.nota}</p> : null}
      <div className="ec-pe">
        {tela === "2a"
          ? <><p className="ob-nota">Dá para mudar depois em Configurações › Suas IAs.</p><Bt acao="computador-continuar" rotulo="Continuar" ia={null} pri executar={executar} /></>
          : <><p className="ob-nota">Sem IA, você vê a plataforma; os bots avisam que estão sem IA.</p>{esperando ? <Bt acao="computador-cancelar" rotulo="Cancelar" ia={principal} executar={executar} /> : <Bt acao="computador-pular" rotulo="Pular por agora" ia={null} executar={executar} />}</>}
      </div>
    </section>
  );
}
