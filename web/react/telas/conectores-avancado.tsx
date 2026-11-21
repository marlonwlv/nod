import { Fragment, useLayoutEffect, useRef } from "react";
import type { Estado } from "../../estado/reducer.ts";
import { falhaVisivel } from "../../lib/fora-do-ar.ts";
import { haQuanto } from "../../lib/relogio.ts";
import { avatarAgente, hora } from "../../lib/render.ts";
import { CAPACIDADES_GITHUB, nativo } from "../../telas/conectores.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { Loja } from "../loja.ts";
import { igualRaso, useLoja } from "../use-loja.ts";

/**
 * ADR-179 (item 2): a tela avançada dos Conectores ("Configurações avançadas": a chave do Composio, o GitHub por token e
 * por App, os MCPs próprios com Sondar, Habilitar e Conceder) em React, no computador. O mesmo DOM de `renderConectores`
 * com `avancado` (web/telas/conectores.ts, a volta com `?telas-react=0`); os formulários e os botões chamam os mesmos
 * handlers do main (`formulario`, `acao`), que leem o formulário e o `dataset` como sempre. Os campos ficam sem controle
 * do React: o que a pessoa digitou fica entre desenhos. A vitrine (o Marketplace) já é o modal do Base UI.
 */
export interface AcoesDosConectores {
  /** Um formulário enviado (o nome do handler de formulários do main e o próprio formulário). */
  formulario: (qual: string, form: HTMLFormElement) => void;
  /** Um botão (o nome do handler de ações do main e o próprio botão, com o `dataset`). */
  acao: (qual: string, el: HTMLElement) => void;
}

type Pedaco = Pick<Estado, "conectores" | "frota" | "concessoes" | "sessao" | "composioConfigurado" | "avisoConexao" | "agora">;

export function TelaConectoresAvancado({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDosConectores }) {
  const e = useLoja(loja, (x): Pedaco => ({ conectores: x.conectores, frota: x.frota, concessoes: x.concessoes, sessao: x.sessao, composioConfigurado: x.composioConfigurado, avisoConexao: x.avisoConexao, agora: x.agora }), igualRaso);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  const html = (h: string) => conversor.current!.converter(h);
  const enviar = (qual: string) => (ev: React.FormEvent<HTMLFormElement>) => { ev.preventDefault(); acoes.formulario(qual, ev.currentTarget); };
  const clicar = (qual: string) => (ev: React.MouseEvent<HTMLButtonElement>) => acoes.acao(qual, ev.currentTarget);
  const temToken = e.conectores.some((c) => c.slug === "github" && c.ownerId === e.sessao?.pessoaId && c.env["GITHUB_TOKEN"] === true);
  const agentes = e.frota?.agentes ?? [];
  return (
    <section className="tela tela-conectores tela-avancado">
      <button type="button" className="bt link" onClick={clicar("navegar-marketplace")}>← Marketplace</button>
      <h1>Configurações avançadas</h1>
      {e.avisoConexao && <p className="connection-notice" role="status">{e.avisoConexao}</p>}
      <details className="composio-setup" open={!e.composioConfigurado || undefined}>
        <summary>{e.composioConfigurado ? "✓ Composio configurado · alterar chave" : "Chave do Composio do time"}</summary>
        <p>A chave do projeto Composio é do time: uma pessoa configura e todos conectam os próprios apps.</p>
        <form className="form composio-form" onSubmit={enviar("configurar-composio")}>
          <label>Chave do projeto<input type="password" name="chave" required autoComplete="off" placeholder="Cole a chave do Composio" /></label>
          <button className="bt pri" type="submit">Salvar e verificar</button>
        </form>
        <a href="https://platform.composio.dev" target="_blank" rel="noopener noreferrer">Abrir Composio ↗</a>
        <small>A chave fica cifrada neste servidor. O Composio gerencia os logins dos apps.</small>
      </details>
      <details className="github-avancado">
        <summary>{`GitHub: token pessoal${temToken ? " · ✓ guardado" : ""}`}</summary>
        <form className="form" onSubmit={enviar("token-github")}>
          <label>Token do GitHub<input type="password" name="token" required autoComplete="off" placeholder="ghp_… ou github_pat_…" /></label>
          <button className="bt" type="submit">Guardar e verificar</button>
        </form>
        <small>Use quando esta máquina não tem o gh logado. O token fica cifrado neste servidor e os comentários saem em nome da conta dele.</small>
      </details>
      <details className="github-avancado">
        <summary>GitHub da organização (rotinas no servidor)</summary>
        <form className="form" onSubmit={enviar("app-github")}>
          <label>App ID<input name="appId" inputMode="numeric" required autoComplete="off" /></label>
          <label>ID da instalação<input name="instalacaoId" inputMode="numeric" required autoComplete="off" /></label>
          <label>Chave privada (.pem)<textarea name="chavePrivada" rows={3} required autoComplete="off" placeholder="-----BEGIN RSA PRIVATE KEY-----" /></label>
          <button className="bt" type="submit">Guardar e verificar</button>
        </form>
        <small>Só para quem administra o GitHub da organização (NOD_ADMINS). Só ROTINAS usam o App, e só de quem não tem gh, token nem Composio; os comentários saem em nome do App. A chave fica cifrada e nunca volta para a tela.</small>
      </details>
      <h2 className="marketplace-heading">Seus MCPs e permissões</h2>
      <details className="registrar">
        <summary>＋ Adicionar servidor MCP próprio</summary>
        <form className="form" onSubmit={enviar("registrar-conector")}>
          <label>Nome <input name="nome" required placeholder="Exemplo" /></label>
          <label>Slug <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" placeholder="exemplo" /></label>
          <label>Transporte <select name="transporte"><option value="stdio">stdio</option><option value="http">http</option></select></label>
          <label>Comando (stdio) <input name="comando" placeholder="node" /></label>
          <label>Args (um por linha) <textarea name="args" rows={2} placeholder="scripts/mcp-exemplo.mjs" /></label>
          <label>URL (http) <input name="url" placeholder="http://127.0.0.1:1234/mcp" /></label>
          <label>Credenciais (JSON: env no stdio, headers no HTTP; cifradas) <textarea name="env" rows={2} placeholder={'{"TOKEN":"…"}'} /></label>
          <label>Declaração <select name="declaracao"><option value="nao-toca">não toca dado pessoal</option><option value="toca">toca dado pessoal</option><option value="nao-declarou">não declaro (= toca)</option></select></label>
          <button className="bt pri" type="submit">Registrar (nasce desabilitado)</button>
        </form>
      </details>
      {e.conectores.length ? (
        <ul className="lista">
          {e.conectores.map((c) => {
            const concedidas = agentes.flatMap((a) => (e.concessoes[a.id] ?? []).filter((g) => g.conectorId === c.id).map((g) => (
              <li key={g.id}>{html(avatarAgente(a, "sm"))}{` ${a.nome} · `}<code>{g.capacidade}</code>{" "}
                <button type="button" className="bt sm" data-id={g.id} data-agente={a.id} onClick={clicar("revogar")}>revogar</button></li>
            )));
            const faltam = nativo(c) && c.catalogo.length ? Object.keys(CAPACIDADES_GITHUB).filter((n) => !c.catalogo.some((cap) => cap.nome === n)) : [];
            const motivo = c.ultimaFalha ? (c.ultimaFalha.causa === "acesso_recusado" ? "recusou o acesso" : c.ultimaFalha.motivo === "timeout_transporte" ? "a conexão com o app demorou demais" : c.ultimaFalha.motivo.replaceAll("_", " ")) : "";
            return (
              <li key={c.id} className="conector" data-conector={c.id}>
                <div className="cn-cab">
                  <b>{c.nome}</b>{" "}<code>{c.slug}</code>{" "}<span className="tag">{c.transporte}</span>{" "}<span className={`tag ${c.habilitado ? "tag-ok" : "tag-cinza"}`}>{c.habilitado ? "habilitado" : "desabilitado"}</span>{" "}
                  <span className={`tag ${c.declaracao === "nao-toca" ? "tag-cinza" : "tag-ambar"}`}>{c.declaracao === "nao-toca" ? "não toca dado pessoal" : c.declaracao === "toca" ? "toca dado pessoal" : "não declarou = toca"}</span>
                  {c.sondadoEm && <span className="mudo">{`sondado ${hora(c.sondadoEm)}`}</span>}
                </div>
                <div className="mudo">{`${nativo(c) ? "conector do próprio nod · o jeito de conectar é escolhido sozinho (gh desta máquina, token, Composio)" : c.transporte === "stdio" ? `${c.comando ?? ""} ${c.args.join(" ")}` : (c.url ?? "")} · env: ${Object.keys(c.env).join(", ") || "—"} (valores só no servidor)`}</div>
                {c.ultimaFalha && falhaVisivel(c) && <div className="negacao negacao-conector_indisponivel">{`conector ${c.slug} indisponível: ${motivo} desde ${hora(c.ultimaFalha.em)} (${haQuanto(e.agora - c.ultimaFalha.em)})`}</div>}
                {c.catalogo.length ? (
                  <ul className="catalogo">
                    {c.catalogo.map((cap) => <li key={cap.nome}><code>{cap.nome}</code>{" "}<span className={`tag ${cap.readOnlyHint ? "tag-cinza" : "tag-ambar"}`}>{cap.readOnlyHint ? "só leitura" : "efeito externo"}</span>{" "}<span className="mudo">{cap.descricao}</span></li>)}
                  </ul>
                ) : <p className="mudo">catálogo vazio — sonde para descobrir as ferramentas</p>}
                {faltam.length > 0 && <p className="mudo">{"Indisponível neste jeito de conectar: "}{faltam.map((n, i) => <Fragment key={n}>{i > 0 && ", "}<code>{n}</code></Fragment>)}{". Com o gh desta máquina ou um token pessoal, tudo fica disponível."}</p>}
                <div className="acoes">
                  <button type="button" className="bt " data-id={c.id} onClick={clicar("sondar-conector")}>Sondar</button>
                  {c.habilitado
                    ? <button type="button" className="bt " data-id={c.id} onClick={clicar("desabilitar-conector")}>Desabilitar</button>
                    : <button type="button" className="bt " data-id={c.id} title="exige catálogo sondado" onClick={clicar("habilitar-conector")}>Habilitar</button>}
                </div>
                {!nativo(c) && (
                  <details><summary>Atualizar credenciais do MCP</summary>
                    <form className="form" data-id={c.id} onSubmit={enviar("credenciais-conector")}>
                      <label>Novas credenciais (JSON)<textarea name="env" rows={2} required autoComplete="off" placeholder={'{"Authorization":"Bearer …"}'} /></label>
                      <p className="mudo">Substitui as credenciais atuais. Depois de salvar, use Sondar para verificar e reativar a conexão.</p>
                      <button className="bt" type="submit">Salvar credenciais</button>
                    </form>
                  </details>
                )}
                {c.catalogo.length > 0 && agentes.length > 0 && (
                  <form className="form linha" data-id={c.id} onSubmit={enviar("conceder")}>
                    <select name="agenteId" aria-label="Bot">{agentes.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}</select>
                    <select name="capacidade" aria-label="Ação">{c.catalogo.map((cap) => <option key={cap.nome} value={cap.nome}>{cap.nome}</option>)}</select>
                    <button className="bt pri" type="submit">Conceder</button>
                  </form>
                )}
                {concedidas.length > 0 && <ul className="lista">{concedidas}</ul>}
              </li>
            );
          })}
        </ul>
      ) : <p className="mudo">Você também pode conectar ferramentas próprias por URL ou comando local.</p>}
    </section>
  );
}
