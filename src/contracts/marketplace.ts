export type AppMarketplace = {
  slug: string;
  /** Só aparece com confirmação do catálogo do provedor; não entra no piso offline. */
  exigeProvedor?: true;
  /** Requisito de conexão que a pessoa precisa conhecer antes do login. */
  orientacaoConexao?: string;
  nome: string;
  descricao: string;
  categoria: string;
  /**
   * definido em 2026-09-24 (ADR-044): o que um pedido SÓ DE LEITURA deixa de fora, em verbos que a
   * pessoa reconhece. Curado à mão; app sem curadoria cai na contagem das ações de escrita do catálogo.
   */
  naoIncluiNaLeitura?: readonly string[];
  /**
   * definido em 2026-09-24 (ADR-048): app que o próprio nod conecta (hoje só o GitHub). Aparece na
   * grade mesmo sem auth config no Composio — o Composio é só um dos jeitos de conectá-lo.
   */
  nativo?: true;
  /**
   * definido em 2026-09-30 (ADR-062, pergunta do Marlon "é o modelo que considera ou é hard coded?"): o que o app
   * devolve é escrito SÓ por gente da empresa (workspace fechado), então ler ele não é "conteúdo de fora" (ADR-026).
   * Curadoria à mão, nunca do modelo — é justamente o modelo que um texto de fora tentaria convencer. Sem a marca,
   * o app conta como de fora (falha fechada): e-mail, GitHub, Drive, agenda (convite de gente de fora), web e todo
   * app novo até alguém revisar. Risco aceito: canal do Slack compartilhado com gente de fora (Slack Connect).
   */
  conteudoInterno?: true;
};

/**
 * definido em 2026-09-17: catálogo Composio; a pessoa autoriza cada app em login separado.
 * revisto em 2026-09-21 (ADR-041): deixou de ser O catálogo e virou a CURADORIA. Quem diz o que
 * existe é o `GET /auth_configs` do Composio; esta lista dá nome, descrição e categoria em
 * português a quem já foi curado, e é o piso quando a chamada ao provedor falha. App configurado
 * no painel e ausente daqui aparece com o nome do provedor e a descrição genérica de CATEGORIA_PADRAO.
 */
const CONSENTIMENTO_MICROSOFT = "Sua organização pode exigir aprovação de um administrador Microsoft Entra. Se o login pedir aprovação, solicite ao administrador que revise as permissões do aplicativo e conceda o consentimento necessário em Aplicativos empresariais. Depois, tente conectar novamente.";

export const APPS_MARKETPLACE: readonly AppMarketplace[] = [
  { slug: "outlook", nome: "Microsoft Outlook", descricao: "Leia emails e consulte calendários. Envio de mensagens e mudanças na agenda exigem permissão de escrita.", categoria: "Comunicação", exigeProvedor: true, orientacaoConexao: CONSENTIMENTO_MICROSOFT, naoIncluiNaLeitura: ["enviar emails", "criar ou alterar eventos", "convidar participantes"] },
  { slug: "microsoft-teams", nome: "Microsoft Teams", descricao: "Consulte equipes, canais e mensagens. Acesso depende das permissões e políticas da sua organização.", categoria: "Comunicação", exigeProvedor: true, orientacaoConexao: CONSENTIMENTO_MICROSOFT, naoIncluiNaLeitura: ["enviar mensagens", "criar reuniões", "adicionar participantes"] },
  { slug: "one-drive", nome: "Microsoft OneDrive", descricao: "Encontre arquivos e consulte pastas. Alterar, excluir ou compartilhar arquivos exige permissão de escrita.", categoria: "Conhecimento", exigeProvedor: true, orientacaoConexao: CONSENTIMENTO_MICROSOFT, naoIncluiNaLeitura: ["enviar arquivos", "apagar", "compartilhar"] },
  { slug: "share-point", nome: "Microsoft SharePoint", descricao: "Consulte sites, listas e documentos aos quais sua conta tem acesso.", categoria: "Conhecimento", exigeProvedor: true, orientacaoConexao: CONSENTIMENTO_MICROSOFT, naoIncluiNaLeitura: ["alterar listas", "enviar arquivos", "mudar permissões"] },
  { slug: "read-ai-mcp", nome: "Read AI", descricao: "Consulte relatórios, resumos e transcrições acessíveis à sua conta. Enviar um bot para gravar exige escrita.", categoria: "Comunicação", exigeProvedor: true, orientacaoConexao: "Requer autenticação Read AI disponível no provedor e Downloads habilitado no workspace. Conectar não inicia gravações.", naoIncluiNaLeitura: ["enviar bot para gravar", "compartilhar relatórios"] },
  { slug: "otter-ai-mcp", nome: "Otter.ai", descricao: "Busque reuniões e leia transcrições às quais sua conta tem acesso. Esta integração não inicia gravações.", categoria: "Conhecimento", exigeProvedor: true, orientacaoConexao: "Requer autenticação Otter disponível no provedor. O acesso depende das permissões da sua conta." },
  { slug: "fathom", nome: "Fathom", descricao: "Consulte reuniões, resumos e transcrições já disponíveis na sua conta. Conectar não inicia gravações.", categoria: "Comunicação", exigeProvedor: true, naoIncluiNaLeitura: ["criar ou excluir webhooks"] },
  { slug: "fireflies", nome: "Fireflies", descricao: "Busque transcrições e consulte reuniões. Enviar áudio ou adicionar o bot a uma reunião exige escrita.", categoria: "Comunicação", exigeProvedor: true, orientacaoConexao: "Conecta com a chave de API da sua conta Fireflies, colada num campo seguro. Nenhum bot vê a chave.", naoIncluiNaLeitura: ["adicionar bot à reunião", "enviar áudio", "apagar transcrições"] },
  { slug: "granola-mcp", nome: "Granola", descricao: "Busque notas e transcrições disponíveis no seu plano. Conectar não captura áudio nem inicia uma reunião.", categoria: "Conhecimento", exigeProvedor: true, orientacaoConexao: "Requer autenticação Granola disponível no provedor. O acesso a transcrições depende do seu plano e das permissões do workspace.", naoIncluiNaLeitura: ["criar notas", "alterar pastas", "editar notas"] },

  { slug: "slack", nome: "Slack", descricao: "Encontre conversas, acompanhe sua equipe e prepare mensagens.", categoria: "Comunicação", conteudoInterno: true },
  { slug: "github", nome: "GitHub", descricao: "Revise pull requests, leia código e acompanhe issues. Usa o gh já logado nesta máquina quando houver.", categoria: "Desenvolvimento", naoIncluiNaLeitura: ["comentar", "revisar pull requests"], nativo: true },
  { slug: "gmail", nome: "Gmail", descricao: "Leia e organize emails, prepare respostas e acompanhe sua caixa de entrada.", categoria: "Comunicação", naoIncluiNaLeitura: ["enviar", "apagar", "arquivar"] },
  { slug: "notion", nome: "Notion", descricao: "Encontre documentos e mantenha as informações do time organizadas.", categoria: "Conhecimento", conteudoInterno: true },
  { slug: "linear", nome: "Linear", descricao: "Acompanhe projetos, organize issues e descubra o que está bloqueado.", categoria: "Projetos", conteudoInterno: true },
  { slug: "googlesheets", nome: "Google Sheets", descricao: "Consulte planilhas, analise resultados e prepare relatórios.", categoria: "Produtividade" },
  { slug: "googlecalendar", nome: "Google Calendar", descricao: "Consulte sua agenda e organize compromissos.", categoria: "Produtividade" },
  { slug: "clickup", nome: "ClickUp", descricao: "Acompanhe tarefas, prazos e prioridades dos seus projetos.", categoria: "Projetos", conteudoInterno: true },
  // definido em 2026-09-21: os quatro auth configs que existiam no painel e não tinham curadoria.
  { slug: "supabase", nome: "Supabase", descricao: "Consulte tabelas, inspecione dados e acompanhe o estado do banco.", categoria: "Desenvolvimento" },
  { slug: "sentry", nome: "Sentry", descricao: "Investigue erros em produção, veja o impacto e priorize correções.", categoria: "Desenvolvimento" },
  { slug: "googledrive", nome: "Google Drive", descricao: "Encontre arquivos, leia documentos e organize as pastas do time.", categoria: "Conhecimento" },
  { slug: "github_mcp", nome: "GitHub MCP", descricao: "Acesso ao GitHub pelo servidor MCP próprio, com as ferramentas que você configurou.", categoria: "Desenvolvimento" },
];

/** O que um app sem curadoria recebe: some da grade nunca, mas também não inventa descrição. */
export const CATEGORIA_PADRAO = "Integrações";
export const DESCRICAO_PADRAO = "Conecte para dar a este app as ferramentas que seus bots podem usar.";

/** Um app do marketplace já mesclado com o catálogo do provedor (src/domain/catalogo-marketplace.ts). */
export type AppComLogo = AppMarketplace & {
  logo: string | null;
  /**
   * definido em 2026-09-29 (ADR-057): veio do catálogo público do Composio, com login gerenciado por
   * ele, sem curadoria e sem auth config no painel. A tela o mostra em "Mais apps", não no dia a dia.
   */
  doCatalogo?: true;
  /**
   * definido em 2026-11-18 (emenda ADR-057): conecta com a chave de API da pessoa, colada num campo seguro, e não
   * com login. Os campos vêm de GET /marketplace/:slug/campos e a conexão de POST /marketplace/:slug/conectar-com-chave.
   */
  conexao?: "chave";
};

/** Um campo que o app pede para conectar por chave (a chave, o subdomínio da conta…), como o Composio descreve. */
export type CampoDeConexao = {
  nome: string;
  rotulo: string;
  /** Onde achar o valor, no texto do provedor (em inglês). */
  descricao: string;
  /** Segredo: a tela usa campo de senha e o valor nunca volta. */
  segredo: boolean;
  obrigatorio: boolean;
};
