import type { AcaoComputador, AmbienteComputador, ResultadoComputador } from "./computador.ts";
import type { MotivoFalhaComputador } from "./motivos.ts";

/**
 * ADR-166 (definido em 2026-11-12): o computador do bot é PLUG AND PLAY. Quem dá a máquina (Docker próprio, o motor da
 * pessoa, um serviço de terceiros como o Orgo) é um `ProvedorDeComputador`; o portão (fundo/computadores.ts), as
 * ferramentas `computador_*` e o agente só conhecem o `DriverComputador` de sempre, montado por cima do provedor escolhido
 * (adapters/computador/provedores/seletor.ts). Trocar de provedor é configuração (`NOD_COMPUTADOR_PROVEDOR`, por pessoa ou
 * por bot), nunca código do agente.
 *
 * Um provedor tem duas metades:
 *   - o CICLO DE VIDA (criar, iniciar, parar, retomar, snapshot, excluir, saúde), sempre;
 *   - o PLANO DE DADOS, de UM de dois jeitos: `executar` (a máquina já roda o runtime do nod — Docker, motor — e entende
 *     a `AcaoComputador` inteira, com quadro, texto da página e cofre), ou `primitivas` (a máquina só sabe tela, mouse,
 *     teclado, comando e arquivos, como os serviços de fora; a camada genérica `executarPorPrimitivas` refaz por cima a
 *     semântica do nod: quadro com revisão e prazo de 2 min, texto paginado com revisão, limites de 512 KiB).
 */

/** Os provedores conhecidos. Um provedor novo entra aqui, no seletor e num arquivo em adapters/computador/provedores/. */
export const PROVEDORES_COMPUTADOR = ["docker", "orgo"] as const;
export type IdProvedorComputador = (typeof PROVEDORES_COMPUTADOR)[number];

/** O que o provedor sabe fazer além do mínimo (criar, iniciar, parar, saúde, tela, mouse, teclado, comando). */
export type CapacidadesProvedor = {
  /** Retomar com a memória (processos e janelas onde estavam), não só o disco. */
  retomarComMemoria: boolean;
  /**
   * Foto do disco: `completo` = tira e restaura no lugar; `so_copia` = a foto vira um computador novo (o clone do Orgo) e
   * restaurar no lugar não existe; `nenhum` = não tem.
   */
  snapshot: "completo" | "so_copia" | "nenhum";
  /** Como a pessoa vê a tela ao vivo: VNC por WebSocket, só capturas periódicas, ou o canal próprio do motor (ADR-138). */
  telaAoVivo: "vnc_websocket" | "capturas" | "motor";
  /** Terminal: só comando com saída (`comando`) ou também PTY interativo por WebSocket (`pty`). */
  terminal: "comando" | "pty";
  /** Navegador: controlado por Playwright no runtime do nod (`playwright`, com URL, abas e diálogos) ou só pela tela (`tela`). */
  navegador: "playwright" | "tela";
  /** Captura de áudio (WAV curto). */
  audio: boolean;
  /** Onde o provedor roda: no host do servidor nod, numa máquina da pessoa, ou na nuvem de um terceiro. */
  onde: "host_do_servidor" | "maquina_da_pessoa" | "nuvem_de_terceiro";
};

/**
 * O computador como o provedor o vê. `id` é sempre o `computadores.id` do nod; o provedor guarda o próprio id (o UUID do
 * Orgo, o nome do container) por conta dele, derivado do nosso (nome `nod-<id>`), para não precisar de coluna nova.
 */
export type RefComputador = { id: string; escopo?: { tenantId: string; pessoaId: string } };

export type EstadoNoProvedor = "inexistente" | "criando" | "ligado" | "suspenso" | "parado" | "erro";

/** A saúde, sem mudar nada (o Orgo tem `GET /health`; o Docker, o ping do runtime). */
export type SaudeComputador = {
  estado: EstadoNoProvedor;
  /** Ligado E respondendo: pronto para uma ação. */
  pronto: boolean;
  motivo: MotivoFalhaComputador | null;
  detalhe: string | null;
  reinicios: number | null;
};

/** O acesso à tela ao vivo que o provedor dá (ADR-138 para o motor; VNC por WebSocket para os de fora). Segredo de sessão. */
export type AcessoTelaAoVivo = { tipo: "vnc_websocket"; url: string; token: string; validoAte: number | null };

export type BotaoMouse = "esquerdo" | "direito" | "meio";

/** O mínimo que uma máquina de fora oferece. Coordenadas em pixels da tela, origem no canto de cima à esquerda. */
export interface PrimitivasDeComputador {
  /** PNG em base64 e o tamanho da tela. */
  capturarTela(ref: RefComputador): Promise<{ png: string; largura: number; altura: number }>;
  clicar(ref: RefComputador, p: { x: number; y: number; botao: BotaoMouse; vezes: number }): Promise<void>;
  arrastar(ref: RefComputador, p: { x: number; y: number; destinoX: number; destinoY: number }): Promise<void>;
  digitar(ref: RefComputador, texto: string): Promise<void>;
  /** Uma tecla ou combinação com `+` (ex.: `ctrl+l`, `Return`). */
  tecla(ref: RefComputador, tecla: string): Promise<void>;
  /** `delta` > 0 rola para baixo, < 0 para cima, em "cliques" da roda. */
  rolar(ref: RefComputador, p: { x: number; y: number; delta: number }): Promise<void>;
  /** Um comando de shell, com prazo; saída combinada e código de saída. */
  comando(ref: RefComputador, comando: string, prazoMs: number): Promise<{ saida: string; codigoSaida: number }>;
  /** Abre a URL no navegador da máquina (pode ser um comando de shell por baixo). */
  abrirUrl(ref: RefComputador, url: string): Promise<void>;
}

export interface ProvedorDeComputador {
  readonly id: IdProvedorComputador;
  readonly capacidades: CapacidadesProvedor;
  /** O ambiente do provedor (flag, imagem, chave de API), sem olhar nenhuma máquina. */
  ambiente(ref?: Pick<RefComputador, "escopo">): Promise<AmbienteComputador>;
  /** Cria a máquina se não existe (idempotente). Não liga uma parada: isso é `iniciar`. */
  criar(ref: RefComputador): Promise<void>;
  /** Cria se preciso, liga e espera ficar pronta. Idempotente com a máquina já pronta. */
  iniciar(ref: RefComputador): Promise<void>;
  /** Desliga guardando o disco (arquivos, logins). Idempotente. */
  parar(ref: RefComputador): Promise<void>;
  /** Volta de onde parou: com a memória quando `retomarComMemoria`, senão é o mesmo que iniciar. */
  retomar(ref: RefComputador): Promise<void>;
  /** Pausa guardando a memória (só com `retomarComMemoria`). */
  suspender?(ref: RefComputador): Promise<void>;
  /** Foto do disco com rótulo; devolve o id da foto no provedor (só com `snapshot` diferente de `nenhum`). */
  snapshot?(ref: RefComputador, rotulo: string): Promise<{ snapshotId: string }>;
  restaurar?(ref: RefComputador, snapshotId: string): Promise<void>;
  /** Apaga a máquina e o disco. Irreversível: só pelo fluxo de remover o computador. */
  excluir?(ref: RefComputador): Promise<void>;
  saude(ref: RefComputador): Promise<SaudeComputador>;
  /** Os ids (nossos) dos computadores ligados neste provedor, para o teto de ligados e a varredura de ociosidade. */
  ligados(): Promise<Set<string>>;
  /** Plano de dados com o runtime do nod dentro (Docker, motor). */
  executar?(ref: RefComputador, acao: AcaoComputador, autor?: "bot" | "pessoa"): Promise<ResultadoComputador>;
  /** Plano de dados mínimo (provedores de fora); `executarPorPrimitivas` faz o resto. */
  primitivas?: PrimitivasDeComputador;
  /** Com `primitivas`: a pasta de trabalho do bot na máquina (o /workspace do runtime do nod). */
  raizDeTrabalho?: string;
  /** O acesso à tela ao vivo, quando `telaAoVivo` é `vnc_websocket`. */
  acessoTela?(ref: RefComputador): Promise<AcessoTelaAoVivo>;
}

/**
 * A escolha do provedor, por configuração (ADR-166). A ordem de precedência é bot > pessoa > global > padrão; o padrão é
 * o que o servidor já fazia (`NOD_COMPUTADORES=docker`; o motor (ADR-122, um computador por pessoa) segue no caminho próprio), para nada mudar sem alguém pedir.
 */
export type ConfigProvedores = {
  padrao: IdProvedorComputador | null;
  global: IdProvedorComputador | null;
  porPessoa: Readonly<Record<string, IdProvedorComputador>>;
  porBot: Readonly<Record<string, IdProvedorComputador>>;
};
