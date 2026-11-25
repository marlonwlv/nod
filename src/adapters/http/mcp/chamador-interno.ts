import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Escopo } from "../../../shared/types.ts";
import type { IdAcao } from "../../../domain/acoes/index.ts";
import { responderErro } from "../erros.ts";
import { casar, type Ctx, type Metodo, type Rota } from "../roteador.ts";

export type PedidoInterno = { metodo: Metodo; caminho: string; corpo?: unknown };
export type RespostaInterna = { status: number; corpo: unknown };
export type ChamadorInterno = (escopo: Escopo, pedido: PedidoInterno) => Promise<RespostaInterna>;

/**
 * Rotas que o cliente MCP nunca chama, nem pelo `nod_chamar_rota`: os próprios tokens MCP (um token não gera outro nem se
 * esconde da lista), o canal SSE (`/eventos`, que não termina) e o endereço da rotina webhook (o GET devolve o segredo
 * inteiro decifrado, e é GET: não tem `acao` para a lista abaixo pegar).
 */
const CAMINHOS_FORA = [/^\/mcp(\/|$)/, /^\/eventos$/, /^\/rotinas\/[^/]+\/endereco$/];

/**
 * As ações do registro que ficam fora do MCP: as que levam um segredo (token, chave, senha, credencial), o pareamento de
 * aparelho (a pessoa confere o código na tela dele), o login OAuth no navegador, as mãos da pessoa no computador do bot e
 * o consentimento de voz. Lista explícita, não "todas as `nunca` do chat": o `nunca` de conversas.enviar ("é o próprio
 * chat") e o dos cartões ("cartão se decide no cartão") falam do bot decidir pela conversa; o cliente MCP age em nome da
 * PESSOA, com o token dela, e mandar mensagem e aprovar um pedido são justamente o que ele existe para fazer.
 */
export const ACOES_FORA_DO_MCP: ReadonlySet<IdAcao> = new Set<IdAcao>([
  "apps.credenciais", "apps.configurar_marketplace", "apps.github_token", "apps.github_app",
  // Conectar um app do Marketplace com a chave de API que a pessoa colou: a chave do app passaria pela conversa do
  // cliente MCP e, com o token vazado, alguém ligaria à conta dela um app numa conta de fora (QA-179).
  "apps.conectar_com_chave",
  // Registrar um app leva segredo (o `env` sai cifrado, como apps.credenciais) e, em stdio, um comando que o servidor roda
  // na sondagem: com o token vazado, isso vira código rodando na máquina que sobrevive à revogação (revisão de QA do PR #22).
  "apps.criar",
  // O convite de máquina com `papel: computador` pareia SEM a tela confirmar e vira uma chave de máquina que sobrevive à
  // revogação do token MCP: é o mesmo poder de criar_chave. Instalar por SSH e confiar numa host key nova pedem o olho da
  // pessoa na impressão digital.
  "maquinas.criar_chave", "maquinas.parear", "maquinas.aprovar_dispositivo", "maquinas.convidar",
  "maquinas.instalar_ssh", "maquinas.credencial_ssh", "maquinas.confiar_ssh",
  // Login de IA numa máquina e OAuth de app: o código e o consentimento são da pessoa, no navegador dela.
  "contas_ia.entrar", "contas_ia.codigo_do_login", "apps.conectar",
  // Gerar o endereço da rotina webhook troca o segredo que a integração de fora usa.
  "rotinas.gerar_endereco",
  "nuvem.conectar_google", "computador.usar_tela", "cartoes.guardar_credencial", "voz.consentir",
  "mcp.criar_token", "mcp.revogar_token",
  // O navegador do bot (ADR-190) e o cofre do nod (QA-221). Guardar um login leva a senha; com o token vazado, alguém
  // planta no cofre o login de uma conta dele e o bot passa a entrar nela (e a mandar para lá o que a pessoa pedir). A
  // escolha do login, o código de uso único, o "Guardar no cofre?" e a sessão trazida do Chrome são segredo que vai do
  // cartão direto à página. Abrir endereço, trocar de aba e ensinar são as mãos da pessoa no navegador, com as sessões
  // dela, como computador.usar_tela. Ficam abertos ao MCP o lugar, o ligar/pausar (como computador.operar), listar e
  // apagar logins e tarefas ensinadas.
  "cofre.criar_login", "navegador.login", "navegador.codigo", "navegador.guardar_login", "navegador.trazer_do_chrome",
  "navegador.ir_para", "navegador.trocar_aba", "navegador.ensinar",
]);

export function rotaForaDoMcp(rota: Rota, caminho: string): boolean {
  if (CAMINHOS_FORA.some((p) => p.test(caminho))) return true;
  return rota.acao !== undefined && ACOES_FORA_DO_MCP.has(rota.acao);
}

/**
 * Servidor MCP do Nod: roda uma rota de pessoa (a família /api/t/:tenant/…) por dentro, com o escopo do token, sem
 * passar pela rede nem pela sessão de cookie. O handler é o MESMO que a tela chama (mesmo caso de uso, mesmas
 * permissões, mesma RLS, mesmo registro de ações), então a paridade com a tela é de graça: o que a tela faz pela rota, o
 * cliente MCP faz igual. A resposta é capturada (ctx.json, ou o que o handler escreveu no res, como o erro de
 * responderErro) e devolvida como dado.
 */
export function criarChamadorInterno(rotas: readonly Rota[]): ChamadorInterno {
  const daPessoa = rotas.filter((r) => !r.interno && !r.publica && !r.maquina && !r.backoffice);
  return async (escopo, pedido) => {
    const url = new URL(pedido.caminho, "http://127.0.0.1");
    const caminho = url.pathname;
    const achado = casar(daPessoa, pedido.metodo, caminho, () => true);
    if (!achado || rotaForaDoMcp(achado.rota, caminho)) return { status: 404, corpo: { codigo: "nao_encontrado", mensagem: "Essa rota não existe ou não está disponível pelo MCP." } };

    const req = new IncomingMessage(new Socket());
    req.method = pedido.metodo;
    req.url = `${caminho}${url.search}`;
    req.headers = { "x-nod-origem": "mcp" };
    const res = new ServerResponse(req);
    let status = 200;
    let capturado: { corpo: unknown } | null = null;
    const partes: Buffer[] = [];
    const paraBuffer = (c: unknown): Buffer | null => (c === undefined || c === null || typeof c === "function" ? null : Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
    // O res não tem socket de verdade: tudo que o handler escreve fica aqui, e o "finish" sai quando ele termina.
    res.writeHead = ((s: number) => { status = s; res.statusCode = s; return res; }) as typeof res.writeHead;
    res.setHeader = (() => res) as typeof res.setHeader;
    res.write = ((c: unknown) => { const b = paraBuffer(c); if (b) partes.push(b); return true; }) as typeof res.write;
    res.end = ((c?: unknown) => { const b = paraBuffer(c); if (b) partes.push(b); res.emit("finish"); return res; }) as typeof res.end;

    const ctx: Ctx = {
      req,
      res,
      escopo,
      params: achado.params,
      corpo: () => Promise.resolve(pedido.corpo ?? {}),
      json: (s, body) => {
        status = s;
        res.statusCode = s;
        capturado = { corpo: body };
        res.emit("finish");
      },
    };
    try {
      await (achado.rota.handler as (c: Ctx) => Promise<void>)(ctx);
    } catch (err) {
      responderErro(res, err, { metodo: pedido.metodo, caminho });
    }
    if (capturado) return { status, corpo: (capturado as { corpo: unknown }).corpo };
    const texto = Buffer.concat(partes).toString("utf8");
    try {
      return { status, corpo: texto ? JSON.parse(texto) : null };
    } catch {
      return { status, corpo: texto };
    }
  };
}
