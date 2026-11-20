# Mapa das jornadas e das ferramentas

O checklist mínimo da rodada (SKILL.md, seção 4). Cada área vira um agente. A coluna "Telas" aponta onde olhar em
`web/telas/` quando um achado precisar de suspeita; as ações têm o id do registro (`docs/paridade.md`).

Em toda área: computador e celular, claro e escuro, teclado sem mouse, e o caminho pelo chat quando
`docs/paridade.md` disser `vivo`.

## Áreas

### 1. Primeira vez e conta
- Onboarding inteiro: apresentação, ligação sem voz, descoberta das IAs, os 10 passos, "Este computador"; cancelar,
  pular, falha e nova tentativa. Telas: `onboarding*`, `apresentacao`, `este-computador`, `react/onboarding`.
- Menu da conta, minha conta, uso da conta, contas de IA (`contas_ia.*`), provedores, termos. Telas: `menu-conta`,
  `minha-conta`, `config-conta`, `contas-ia`, `uso-da-conta`, `aviso-termos*`.

### 2. Barra lateral e navegação
- Barra redimensionável (240–400, compacta de 88, ⌘B), fixar, ocultar, reordenar arrastando, times (`times.*`),
  seções recolhidas, não lidos, busca ⌘K, paleta, tab bar do celular, busca do celular. Telas: `barra`, `frota`,
  `paleta`, `nao-lidos*`, `tab-bar-celular`, `busca-celular`.

### 3. Criar e gerir bots
- Botão +, boas-vindas com pergunta e opções, "Outra coisa", criar pela conversa com o Nod (`gerir_bots`,
  `criar_bots`), editar perfil, cor e forma, duplicar, mover de time, excluir e restaurar, versões do perfil, modo de
  aprovação, inteligência (IA, modelo, raciocínio), voz, memória. Ações `bots.*`, `memoria.*`. Telas: `criar-bot`,
  `novo-bot`, `boas-vindas`, `confirmar-criar-bot`, `config-agentes`, `inteligencia`, `memoria`, `historico-perfil`,
  `gestao*`, `agentes-lote`.

### 4. Conversa
- Enviar, indicador (Trabalhando, Refletindo, ferramenta, Digitando…), resposta num balão, formato (lista, título,
  código com Copiar, link com prévia, tabela, diagrama), mensagem enviada com o bot trabalhando, Parar, anexos e
  prévia de arquivo, ditado, busca na conversa, reações, responder a uma mensagem, desfazer, rascunho guardado, troca
  de bot sem "carregando", divisores de data, não lidos no chat, pergunta com botões, pedido à pessoa, "me chame às".
  Telas: `conversa*`, `pilula-do-bot`, `cartao-pergunta`, `pergunta`, `previa-arquivo`, `ditado*`, `busca-na-conversa`,
  `rascunhos-de-envio`, `desfazer`.

### 5. Aprovações e "Sua vez"
- Modo manual, automático e "ignorar todas"; cartão de aprovação, aprovar, negar, vencer; revisor do automático; fila
  "Sua vez"; aprovações em lote. Ações `aprovacoes.*`, `modo.*`. Telas: `aprovacoes`, `sua-vez`, `cartao-revisor`,
  `config-aprovacoes`, `linha-do-modo`, `negacao`.

### 6. Rotinas e agenda
- Criar pela tela e pelo chat, ritmo, pausar, reativar, executar agora, excluir, histórico, "rotina precisa" de acesso.
  Ações `rotinas.*`. Telas: `rotinas`, `nova-rotina`, `agenda-rotinas`, `ritmo-rotina`, `rotina-precisa`.

### 7. Trabalhos, quadro e tarefas
- Trabalhos do bot e de todos, quadro em lista e grade (`?quadro-react=1` para a grade nova), arrastar entre colunas,
  "Mover para…", colunas (criar, renomear, remover), filtros, tarefa aberta (lado, folhas, campos, trabalhos,
  transcrição do run), quadro compartilhado, quadro no celular. Ações `quadro.*`, `trabalhos.*`. Telas: `quadro*`,
  `trabalhos*`, `tarefa-celular`, `colunas-quadro`, `menu-do-quadro`, `opcoes-quadro`, `seletor-de-quadro`.

### 8. Computador do bot
- Ligar, tela cheia, assistir, assumir, Parar, pedido de ajuda (Precisa de você, Já resolvi), mensagem nova devolve o
  controle, fora do ar e tentar de novo, configurações do computador, remover, logins salvos. Ações `computador.*`.
  Telas: `computador*`, `tela-cheia`, `config-computador`, `remover-computador`.

### 9. Canvas, apps, páginas e artefatos
- Canvas (criar, comentar, versões), marketplace, apps conectados e acessos, páginas do bot (pedir um app), artefatos
  e diagramas vivos, biblioteca. Ações `canvas.*`, `apps.*`, `acessos.*`, `paginas.*`, `artefatos.*`. Telas:
  `marketplace*`, `conectores`, `acessos-do-app`, `app-acesso`, `paginas`, `artefatos-vivos`, `diagramas-vivos`,
  `biblioteca`, `card-app`, `card-acesso`.

### 10. Máquinas, workspace e ligação
- Máquinas e "onde roda", parear Mac, máquina na nuvem (só até onde não exige conta), workspace (pasta, projeto,
  terminal), ligação por voz (consentimento; sem microfone real, só até onde a tela vai). Ações `maquinas.*`,
  `nuvem.*`, `voz.*`. Telas: `maquinas`, `onde-roda`, `parear-mac`, `workspace`, `ligacao*`, `consentimento-voz`.

### 11. Salas, colegas e frentes
- Sala geral, falar com vários bots, pedir a um colega, passar e encaminhar, frentes (subagentes), handoff. Ações
  `salas.*`. Telas: `sala`, `dialogo-handoff`, `onde-trabalham`.

### 12. Configurações e preferências
- Geral, tema, balão da pessoa (cor ou preto), densidade, cofre, relatos e reportar bug, modo dev, raio-x. Ações
  `preferencias.*`, `relatos.*`. Telas: `config-*`, `relatos`, `reportar-bug`, `modo-dev`, `raio-x*`.

## Ferramentas do bot

Um grupo por arquivo de `src/contracts/ferramentas-*.ts`. Para cada um, uma mensagem que leve o bot a usar a
ferramenta e a conferência do efeito na tela e na API. "Fora" = exige conta real ou hardware; registre como não
coberto.

| Grupo | Ferramentas | Observação |
| --- | --- | --- |
| `do-nod` | `gerir_bots`, `ver_apps_conectados`, `registrar_relato` | pela conversa com o Nod |
| `criar-bots` | `criar_bots` | |
| `nod` | `lembrar`, `pedir_acesso`, `pedir_aprovacao`, `pedir_a_pessoa`, `passar`, `encaminhar`, `sem_novidade`, `pedir_a_bot`, `atualizar_perfil`, `ver_colegas` | |
| `rotina` | `criar_rotina`, `listar_rotinas`, `ver_agenda`, `pausar_rotina`, `reativar_rotina`, `atualizar_rotina`, `excluir_rotina`, `executar_rotina` | |
| `trabalho` | `abrir_task`, `mandar_para_task`, `me_chame_as`, `esperar_comando` | |
| `frente` | `abrir_frentes`, `mandar_para_frente`, `devolver_resumo` | |
| `quadro` | as operações de tarefas, colunas, vistas e filtros | |
| `canvas` | `gerir_canvas` | |
| `apps`, `acessos` | `gerir_apps`, `gerir_acessos` | apps reais: fora |
| `times`, `barra` | `gerir_times`, `ajustar_barra_lateral` | |
| `cartoes`, `aviso`, `responder-pedido` | `mostrar_cartoes`, `avisar_pessoa`, `responder_pedido` | |
| `artefato` | `publicar_artefato`, `ler_artefato` | |
| `conversas`, `nao-lidos` | `buscar_conversas`, `ler_conversa`, `nao_lidos` | |
| `perfil`, `conta` | `atualizar_perfil`, `ver_colegas`, `abrir_conta` | |
| `computador` | `computador_observar`, `_navegar`, `_interagir`, `_audio`, `_abas`, `_arquivos`, `_ler_arquivo`, `_ler_texto`, `_gravar_texto`, `_gravar_arquivo`, `_terminal`, `_pedir_ajuda` | um computador por vez |
| `computadores`, `maquinas` | `computador`, `manter_ias`, `manter_conexao`, `remover_computador`, `gerir_maquinas` | |
| `workspace` | `workspace_*` | |
| `credencial`, `proxy` | `pedir_credencial`, proxy de schema | credenciais reais: fora |
| `ligacao` | `iniciar_tarefa`, `desligar`, `anotar_entrevista`, `concluir_entrevista`, `propor_bot` | voz real: fora |

## Volume (servidor carga)

- 60 bots criados pela API; a barra com todos (rolagem, busca, compacta, celular).
- Uma conversa com 1.000 mensagens (rolagem, ir ao fim, busca, carregar o começo).
- 5 bots respondendo ao mesmo tempo com a conversa aberta (o catcher com atraso).
- Um quadro com 300 tarefas (lista, grade, arrastar).
- `node scripts/carga-tela/rodar.ts` e `node scripts/alvos-44px/rodar.ts [claro|escuro]`.

## Resiliência (servidor carga)

- Recarregar no meio de um turno; fechar e abrir a aba; duas abas na mesma conversa.
- Reiniciar o servidor com a tela aberta (o SSE volta? a tela relê?).
- Rede offline e de volta (`Network.emulateNetworkConditions`).
- Mensagem enviada offline (o reenvio guardado).
