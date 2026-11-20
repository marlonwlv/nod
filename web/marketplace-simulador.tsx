import "./lib/mascote-elemento.ts";
import { useState } from "react";
import { desenharMarketplace } from "./react/marketplace/regiao.tsx";
import { criarApiSimulada } from "./react/marketplace/simulado.ts";
import type { InicialDoMarketplace } from "./react/marketplace/tipos.ts";

/**
 * Só no dev: /marketplace-simulador.html?estado=<id> abre o Marketplace em modal com o adaptador simulado, já no estado
 * de um artboard do Paper ("Apps por chave de API · jornada"). `&controle=0` esconde o controle do canto (para a foto),
 * `&tema=escuro` força o tema escuro e `&latencia=<ms>` muda a "rede" (1500 por padrão).
 */

const CHAVE_FIREFLIES = "ff_live_8Jq2mW7xKp4nR9sT3v"; // 24 caracteres: os 24 pontos do T4 e do T5
const CHAVE_FRESHDESK = "Xk29fLmQ7rTz4WcB8nPa"; // 20 caracteres: os 20 pontos do T3

type Estado = { id: string; rotulo: string; inicial: InicialDoMarketplace; firefliesConectado?: boolean };

const ESTADOS: readonly Estado[] = [
  { id: "d1", rotulo: "D1 Apps", inicial: {} },
  { id: "t1", rotulo: "T1 Busca", inicial: { busca: "reuniões", realce: "fireflies" } },
  { id: "t2", rotulo: "T2 Fireflies", inicial: { vista: { tipo: "chave", slug: "fireflies" } } },
  { id: "t3", rotulo: "T3 Freshdesk", inicial: { vista: { tipo: "chave", slug: "freshdesk" }, preenchido: { subdominio: "acme", api_key: CHAVE_FRESHDESK } } },
  { id: "t4", rotulo: "T4 Testando", inicial: { vista: { tipo: "chave", slug: "fireflies" }, preenchido: { api_key: CHAVE_FIREFLIES }, envio: "testando" } },
  { id: "t5", rotulo: "T5 Recusada", inicial: { vista: { tipo: "chave", slug: "fireflies" }, preenchido: { api_key: CHAVE_FIREFLIES }, envio: "recusada" } },
  { id: "t6", rotulo: "T6 Quem pode usar", firefliesConectado: true, inicial: { vista: { tipo: "acessos", slug: "fireflies", conectorId: "sim-fireflies", conectadoAgora: true }, selecionados: ["clarice", "ada"] } },
  { id: "t6b", rotulo: "T6b Confirmar", firefliesConectado: true, inicial: { vista: { tipo: "acessos", slug: "fireflies", conectorId: "sim-fireflies", conectadoAgora: true }, selecionados: ["clarice", "ada"], confirmarEscrita: true } },
];

const parametros = new URLSearchParams(location.search);
const atual = ESTADOS.find((e) => e.id === (parametros.get("estado") ?? "d1").toLowerCase()) ?? ESTADOS[0]!;
const comControle = parametros.get("controle") !== "0";
const latencia = Number(parametros.get("latencia") ?? "1500");

let aviso: string | null = null;
let vez = 0;
const api = criarApiSimulada({
  latenciaMs: Number.isFinite(latencia) && latencia >= 0 ? latencia : 1500,
  firefliesConectado: atual.firefliesConectado === true,
  aoAbrirAvancado: () => { aviso = "No app, Avançado fecha o modal e abre a tela de sempre (chave do Composio, MCP próprio)."; abrir(); },
});

function Controle() {
  const [visto, setVisto] = useState(aviso);
  if (!comControle) return null;
  return (
    <>
      <nav className="mk-sim-controle" aria-label="Estados do protótipo">
        {ESTADOS.map((e) => <a key={e.id} href={`?estado=${e.id}`} aria-current={e.id === atual.id ? "page" : undefined}>{e.rotulo}</a>)}
      </nav>
      {visto ? <button type="button" className="mk-sim-aviso" onClick={() => { aviso = null; setVisto(null); }}>{visto}</button> : null}
    </>
  );
}

function abrir(): void {
  document.getElementById("mk-sim-reabrir")?.remove();
  vez++;
  desenharMarketplace({ vez, api, inicial: vez === 1 ? atual.inicial : {}, aoFechar: fechar, extra: <Controle key={`${vez}-${aviso ?? ""}`} /> });
}

function fechar(): void {
  desenharMarketplace(null);
  const bt = document.createElement("button");
  bt.id = "mk-sim-reabrir";
  bt.type = "button";
  bt.className = "rx-mk-bt rx-mk-pri mk-sim-reabrir";
  bt.textContent = "Abrir o Marketplace";
  bt.addEventListener("click", abrir);
  document.body.append(bt);
}

abrir();
