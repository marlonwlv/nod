import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { avisoDoResultado, campoRecusado, fraseDoFormulario, passosPadrao, podeConectar, rotuloDoCampo, valoresDoFormulario } from "./modelo.ts";
import { AvisoDeErro, IconeCadeado, IconeExterno, Logo, Trechos } from "./pecas.tsx";
import { Topo } from "./vitrine.tsx";
import { ErroDoFormulario, type ApiDoMarketplace, type AppDaVitrine, type CampoNaTela, type FormularioDaChave, type ResultadoDaChave } from "./tipos.ts";

/**
 * Conectar com a chave de API (Paper T2 um campo, T3 dois campos, T4 testando, T5 recusada). Os campos vêm do servidor
 * (GET /marketplace/:slug/campos) e são desenhados de forma genérica: o segredo é campo de senha com Mostrar, o resto é
 * texto (com o "https://" e o ".freshdesk.com" em volta, quando o app diz).
 *
 * O VALOR MORA SÓ NO <input> (o precedente de web/telas/card-credencial.ts): o estado do React guarda só QUAIS campos
 * têm algo (para acender o Conectar) e quais estão à mostra. Na hora do envio os valores são lidos do formulário e vão
 * direto para `conectarComChave`; nada deles fica no estado, no armazenamento do navegador ou no log. Os atributos
 * autocomplete="off" + data-1p-ignore/data-lpignore/data-bwignore são os do cartão: o gerenciador de senhas não oferece,
 * não gera nem salva (a chave do app não é senha do nod).
 */

export type PropsDaChave = {
  app: AppDaVitrine;
  api: ApiDoMarketplace;
  aoVoltar: () => void;
  aoFechar: () => void;
  aoConectar: (conectorId: string) => void;
  aoAbrirAvancado: () => void;
  /** Só o simulador: valores já digitados (T3) e o estado de envio (T4, T5). */
  preenchido?: Record<string, string> | undefined;
  envioInicial?: "testando" | "recusada" | undefined;
};

type Carga = { tipo: "carregando" } | { tipo: "pronto"; form: FormularioDaChave } | { tipo: "erro"; motivo: ErroDoFormulario["motivo"] };

export function ConectarComChave({ app, api, aoVoltar, aoFechar, aoConectar, aoAbrirAvancado, preenchido, envioInicial }: PropsDaChave) {
  const [carga, setCarga] = useState<Carga>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [preenchidos, setPreenchidos] = useState<ReadonlySet<string>>(() => new Set(Object.entries(preenchido ?? {}).filter(([, v]) => v.trim()).map(([k]) => k)));
  const [mostrando, setMostrando] = useState<ReadonlySet<string>>(new Set());
  const [testando, setTestando] = useState(envioInicial === "testando");
  const [resultado, setResultado] = useState<ResultadoDaChave | null>(envioInicial === "recusada" ? { tipo: "recusada" } : null);
  const form = useRef<HTMLFormElement | null>(null);
  const vivo = useRef(true);
  // O StrictMode desmonta e remonta: a remontagem precisa religar.
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  useEffect(() => {
    let atual = true;
    setCarga({ tipo: "carregando" });
    api.campos(app.slug).then(
      (f) => { if (atual) setCarga({ tipo: "pronto", form: f }); },
      (e: unknown) => { if (atual) setCarga({ tipo: "erro", motivo: e instanceof ErroDoFormulario ? e.motivo : "indisponivel" }); },
    );
    return () => { atual = false; };
  }, [api, app.slug, tentativa]);

  const campos = carga.tipo === "pronto" ? carga.form.campos : [];
  const aviso = avisoDoResultado(app.nome, resultado);
  const recusado = campoRecusado(resultado);
  const segredos = campos.filter((c) => c.segredo);
  const ultimoSegredo = segredos.at(-1)?.nome ?? campos.at(-1)?.nome;

  function aoDigitar(nome: string, valor: string): void {
    const tem = valor.trim() !== "";
    if (tem === preenchidos.has(nome)) return;
    const s = new Set(preenchidos);
    if (tem) s.add(nome);
    else s.delete(nome);
    setPreenchidos(s);
  }

  async function enviar(ev: FormEvent): Promise<void> {
    ev.preventDefault();
    if (testando || !podeConectar(campos, preenchidos) || !form.current) return;
    const el = form.current;
    // Lido na hora, do próprio campo; a variável morre com esta função.
    const valores = valoresDoFormulario(campos, (nome) => (el.elements.namedItem(nome) as HTMLInputElement | null)?.value ?? "");
    setTestando(true);
    setResultado(null);
    const r = await api.conectarComChave(app.slug, valores);
    if (!vivo.current) return;
    if (r.tipo === "conectado") { aoConectar(r.conectorId); return; }
    setTestando(false);
    setResultado(r);
    if (campoRecusado(r)) queueMicrotask(() => el.querySelector<HTMLInputElement>("input[aria-invalid=true]")?.focus());
  }

  const titulo = `Conectar o ${app.nome}`;
  return (
    <main className="rx-mk-conteudo" aria-labelledby="rx-mk-titulo">
      <Topo titulo={titulo} conectados={null} aoFechar={aoFechar} trilha={aoVoltar} />
      <div className="rx-mk-app">
        <Logo app={app} tamanho="grande" />
        <div className="rx-mk-app-texto">
          <p className="rx-mk-app-nome">{app.nome}</p>
          <p className="rx-mk-app-desc">{app.descricao}</p>
        </div>
      </div>
      {carga.tipo === "carregando" ? <p className="rx-mk-nota" role="status">Vendo o que o {app.nome} pede para conectar…</p> : null}
      {carga.tipo === "erro" ? (
        <AvisoDeErro
          frase={carga.motivo === "nao_configurado" ? "O serviço de conexão do time ainda não está configurado." : `Não deu para ver o que o ${app.nome} pede agora.`}
          mais={carga.motivo === "nao_configurado" ? "Quem cuida do nod configura em Avançado, uma vez para todo mundo." : "Tente de novo em instantes."}
          acoes={carga.motivo === "nao_configurado"
            ? <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={aoAbrirAvancado}>Abrir Avançado</button>
            : <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>}
        />
      ) : null}
      {carga.tipo === "pronto" ? (
        <>
          <p className="rx-mk-frase"><Trechos trechos={fraseDoFormulario(app.nome, campos)} /></p>
          <OndeAchar app={app} form={carga.form} apagado={testando} />
          <form ref={form} className={`rx-mk-campos${aviso ? " rx-mk-com-erro" : ""}`} onSubmit={(ev) => void enviar(ev)} noValidate aria-label={titulo} id="rx-mk-form-chave">
            {campos.map((c) => (
              <Fragment key={c.nome}>
                <Campo campo={c} campos={campos} lendo={testando} recusado={recusado && c.segredo} mostrando={mostrando.has(c.nome)} valorInicial={preenchido?.[c.nome]}
                  aoDigitar={(v) => aoDigitar(c.nome, v)}
                  aoMostrar={() => setMostrando((m) => { const s = new Set(m); if (s.has(c.nome)) s.delete(c.nome); else s.add(c.nome); return s; })}
                  descritoPor={aviso && c.segredo ? "rx-mk-erro-chave" : undefined} />
                {c.nome === ultimoSegredo ? (
                  <>
                    {aviso ? <AvisoDeErro id="rx-mk-erro-chave" frase={aviso.frase} mais={aviso.mais} acoes={resultado?.tipo === "nao_configurado" ? <button type="button" className="rx-mk-bt rx-mk-baixo" onClick={aoAbrirAvancado}>Abrir Avançado</button> : undefined} /> : null}
                    {segredos.length ? <p className="rx-mk-sigilo"><IconeCadeado />A chave vai cifrada para o serviço de conexão do nod. Nenhum bot vê a chave, e ela nunca aparece no chat.</p> : null}
                    {testando ? <p className="rx-mk-testando" role="status"><span className="rx-mk-ponto" aria-hidden="true" />Perguntando ao {app.nome} se a chave vale. Leva alguns segundos.</p> : null}
                  </>
                ) : null}
              </Fragment>
            ))}
          </form>
        </>
      ) : null}
      <div className="rx-mk-rodape">
        <button type="button" className="rx-mk-bt" onClick={aoVoltar}>Cancelar</button>
        {testando ? (
          <button type="button" className="rx-mk-bt rx-mk-pri" disabled aria-busy="true"><span className="rx-mk-giro" aria-hidden="true" />Testando a chave…</button>
        ) : (
          <button type="submit" form="rx-mk-form-chave" className="rx-mk-bt rx-mk-pri" disabled={carga.tipo !== "pronto" || !podeConectar(campos, preenchidos)}>{resultado ? "Tentar de novo" : "Conectar"}</button>
        )}
      </div>
    </main>
  );
}

/** `apagado`: enquanto a chave é testada o passo a passo já cumpriu o papel (Paper T4: opacidade 0.5). */
function OndeAchar({ app, form, apagado = false }: { app: AppDaVitrine; form: FormularioDaChave; apagado?: boolean }) {
  const passos = form.passos ?? passosPadrao(app.nome);
  // Sem os passos do app, a frase do provedor (em inglês) diz onde a chave fica: melhor que nada, e é a fonte.
  const doProvedor = form.passos ? null : (form.campos.find((c) => c.segredo)?.descricao.trim() || null);
  return (
    <section className={`rx-mk-onde${apagado ? " rx-mk-apagado" : ""}`} aria-labelledby="rx-mk-onde-t">
      <div className="rx-mk-onde-topo">
        <span id="rx-mk-onde-t">Onde achar a chave</span>
        {app.site ? <a className="rx-mk-abrir-app" href={app.site} target="_blank" rel="noopener noreferrer">Abrir o {app.nome}<IconeExterno /></a> : null}
      </div>
      <ol className="rx-mk-passos">
        {passos.map((p, i) => <li key={i} className="rx-mk-passo"><span className="rx-mk-passo-n" aria-hidden="true">{i + 1}</span><span><Trechos trechos={p} /></span></li>)}
      </ol>
      {doProvedor ? <p className="rx-mk-provedor" lang="en">{doProvedor}</p> : null}
    </section>
  );
}

type PropsDoCampo = {
  campo: CampoNaTela;
  campos: readonly CampoNaTela[];
  lendo: boolean;
  recusado: boolean;
  mostrando: boolean;
  valorInicial: string | undefined;
  aoDigitar: (valor: string) => void;
  aoMostrar: () => void;
  descritoPor: string | undefined;
};

function Campo({ campo, campos, lendo, recusado, mostrando, valorInicial, aoDigitar, aoMostrar, descritoPor }: PropsDoCampo) {
  const id = `rx-mk-campo-${campo.nome}`;
  const dicaId = `${id}-dica`;
  const dica = campo.segredo ? null : (campo.dica ?? (campo.descricao.trim() || null));
  const classe = `rx-mk-campo${campo.segredo ? "" : " rx-mk-sem-mostrar"}${campo.sufixo ? " rx-mk-com-sufixo" : ""}${lendo ? " rx-mk-lendo" : ""}${recusado ? " rx-mk-recusado" : ""}`;
  const descricoes = [dica ? dicaId : null, descritoPor ?? null].filter(Boolean).join(" ") || undefined;
  const entrada = (
    <input
      id={id}
      name={campo.nome}
      type={campo.segredo && !mostrando ? "password" : "text"}
      defaultValue={valorInicial}
      placeholder={campo.segredo ? "Cole a chave aqui" : (campo.exemplo ?? "")}
      readOnly={lendo}
      required={campo.obrigatorio}
      aria-required={campo.obrigatorio}
      aria-invalid={recusado || undefined}
      aria-describedby={descricoes}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      maxLength={4096}
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore=""
      onInput={(ev) => aoDigitar((ev.target as HTMLInputElement).value)}
    />
  );
  const rotulo = <label className="rx-mk-campo-rotulo" htmlFor={id}>{rotuloDoCampo(campo, campos)}</label>;
  if (!campo.segredo) {
    return (
      <div className="rx-mk-campo-aberto">
        {rotulo}
        {/* O campo inteiro é alvo do clique: o "https://" e o ".freshdesk.com" em volta levam o foco para dentro. */}
        <label className={classe} htmlFor={id}>
          {campo.prefixo ? <span className="rx-mk-campo-fixo" aria-hidden="true">{campo.prefixo}</span> : null}
          {entrada}
          {campo.sufixo ? <span className="rx-mk-campo-fixo" aria-hidden="true">{campo.sufixo}</span> : null}
        </label>
        {dica ? <p className="rx-mk-dica" id={dicaId}>{dica}</p> : null}
      </div>
    );
  }
  return (
    <>
      {rotulo}
      <div className={classe}>
        {entrada}
        <button type="button" className="rx-mk-mostrar" aria-pressed={mostrando} aria-controls={id} onClick={aoMostrar}>{mostrando ? "Ocultar" : "Mostrar"}</button>
      </div>
    </>
  );
}
