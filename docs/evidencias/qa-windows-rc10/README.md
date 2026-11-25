# QA geral — nod 1.0.0-rc.10 no Windows (computer-2511)

Data: 25/11/2026 (02:24–02:59 UTC) · Testador: Chico (QA, agente do nod) · IA usada: Claude (plano Team, Auto · Opus)

## Resumo

**O básico funciona no Windows com o Claude.** Conversa, criar bot, tarefa que mexe em arquivo, anexo, rotinas (criar, testar agora, pausar, reativar, excluir), busca, botão Parar, Tarefas, Marketplace e Configurações funcionaram. O app também se recupera bem quando o motor cai: a tarefa agendada religa o motor em cerca de 10 s e a mensagem que estava na fila é respondida.

Nenhum bloqueante. Os problemas são de **textos de Mac no Windows**, **fuso horário das rotinas**, **sobreposição de botões nas Configurações**, **ausência de "Excluir" na tela de Rotinas**, **app sem log em disco no Windows** e alguns detalhes de layout e de persistência.

Desempenho: resposta simples em menos de 13–18 s, tarefa com arquivo em menos de 19 s e abertura a frio em cerca de 7 s (cerca de 3 s de tela branca). Em repouso o app ocupa cerca de 360 MB (4 processos nod.exe somam ~356 MB, mais o motor com ~45 MB) e a CPU fica em ~5%. Durante uma resposta, o processo claude.exe chega a ~180 MB e a CPU total vai a 62–93% (a máquina tem 2 vCPUs).

Os pontos da rodada anterior (PR #327) **não mudaram**, porque o build ainda é o rc.10: o card antigo "Argument,codex.ps1" continua na conversa da Lia, e a linha "A sessão anterior não estava mais no Windows" aparece. Agora, com o Claude, a Lia responde normalmente. A linha antiga virou "✓ A mensagem saiu · Lia não conseguiu recomeçar", um texto contraditório (achado 14).

## Ambiente
Windows Server 2022 Datacenter Eval 10.0.20348, 2 vCPU, 8 GB, fuso UTC · nod 1.0.0-rc.10 · node 24.19.0 (empacotado) · git 2.56.1 · Claude Code 2.1.332 · codex-cli 0.172.0 (sem login). Claude: Conta Team, modelo Auto · Opus.

## O que passou
| Fluxo | Resultado | Evidência |
|---|---|---|
| Conversa com a Lia via Claude | ok, "Oi! 7 vezes 8 é 56." em menos de 18 s | 10, 11-resp-6 |
| Criar bot "Testador QA" | ok (o botão Criar fica desabilitado sem nome; o onboarding do bot faz uma pergunta A/B/C/D) | 12–17 |
| Tarefa com arquivo | ok, criou `C:\Users\Administrator\nod\Testador QA\teste-qa.txt` (9 bytes, conferido no disco) | 18-* |
| Rotina: criar, testar agora, pausar, reativar | ok, o lembrete chegou na conversa em cerca de 14 s | 19–28 |
| Rotina: excluir | ok só pela conversa (ver achado 4) | 32 |
| Nova tarefa com anexo CSV | ok: soma 100, maior valor gama; aparece em Tarefas › Feitas | 37–42 |
| Busca (lupa) | ok, achou a tarefa "CSV" | 62 |
| Parar a resposta | ok, "Parado por você" com "Mostrar o texto todo" | 64, 65 |
| Marketplace (sem conectar) e busca sem resultado | ok, com estado vazio claro | 01, 03 |
| Configurações (todas as abas) e Aprovações (Automático) | ok, com ressalvas abaixo | 06–08, 07-cfg-* |
| Fechar no X e reabrir pela bandeja | ok, mantém a conversa e as abas | 54, 55 |
| Motor morto (Stop-Process) | recupera sozinho em cerca de 10 s e responde a fila | 59–61 |

## Achados

| # | Título | Sev. | Print |
|---|---|---|---|
| 1 | Rotina diz "Onde roda: seu Mac · precisa estar ligado" numa máquina só com Windows | médio | [21-rotina-detalhe](prints/21-rotina-detalhe.png) |
| 2 | "Próxima vez 12:00 hoje" na lista de Rotinas mostra a hora no fuso da máquina (UTC), não no fuso da rotina (09:00 America/Sao_Paulo) | médio | [20-cfg-rotinas-com-1](prints/20-cfg-rotinas-com-1.png) |
| 3 | O bot confirma a data errada da rotina ("O primeiro sai amanhã, 26/11"), enquanto o sistema mostra 25/11 09:00 | médio | [19-rotina-5](prints/19-rotina-5.png) |
| 4 | Não há como excluir uma rotina pela tela de Rotinas (o "…" só expande; a pausada não tem menu) | médio | 25, 29b |
| 5 | Botões "Nova rotina" e "Enviar feedback" ficam por baixo do X de fechar das Configurações (cortados) | médio | 20-cfg-rotinas-com-1, 07-cfg-feedback |
| 6 | App sem log em disco no Windows: `%APPDATA%\nod\logs\nod.log` não existe | médio | — |
| 7 | Tema: "Sistema acompanha o modo claro ou escuro do macOS" no Windows | baixo | [07-cfg-geral](prints/07-cfg-geral.png) |
| 8 | Configurações › Apps troca o modal pelo Marketplace, sem volta para Configurações | baixo | 07-cfg-apps |
| 9 | Alt+, (Configurações) não funciona com o foco no campo de mensagem | baixo | 20 (1ª tentativa) |
| 10 | Na largura mínima (900 px) aparece barra de rolagem horizontal na conversa e o seletor de modelo vira um ícone "⇕" sem rótulo | baixo | 48, 44 |
| 11 | Reabrir após "Sair" não restaura a última conversa (abre na Lia) nem a janela maximizada; tela branca por cerca de 3 s | baixo | 58-relancar-1..4 |
| 12 | Tarefas › "Todas" e "Feitas" vazias mostram o texto de "Nenhum bot está trabalhando agora" | baixo | 34 |
| 13 | Com o motor fora, a mensagem só fica "Na fila", sem avisar que o motor caiu | baixo | 60 |
| 14 | Texto contraditório: "✓ A mensagem saiu · Lia não conseguiu recomeçar" | baixo | 11-resp-6 |
| 15 | Seletor de arquivo do anexo abre na pasta de instalação (`Programs\nod`) | baixo | 38 |
| 16 | Anexo CSV aparece com o selo "TXT"; o card "PEDIDO" da tarefa não mostra o anexo | baixo | 39, 40-* |
| 17 | Detalhes de texto e visual: fuso repetido ("(America/Sao_Paulo) (fuso America/Sao_Paulo)"); data em mm/dd/yyyy na UI em pt-BR; caminho `~/nod/...` no estilo Unix; passo técnico "Buscou ferramentas select:mcp__nod__devolver_resumo" visível ao usuário; título da tarefa cortado em "Leia o CSV anexado e me"; nome "Claude · …" truncado em Provedores; logos genéricos (letra) no Marketplace; cabeçalho do modal rola e o X fica parado | baixo | 21, 40, 06, 01, 27 |
| 18 | Itens transitórios: bot novo aparece duplicado ("Criando…" mais o real) por cerca de 2 s; a linha "Não lidos" surge e empurra a lista no meio do clique; o 1º clique em "eu" depois de fechar o Marketplace com Esc não abre o menu | baixo | 14, 43, 04 |

### Detalhes

**1. "seu Mac" na rotina do Windows** (médio)
- Passos: com a Máquina padrão em "Qualquer uma" e só o PC Windows, peça uma rotina ao bot e abra Configurações › Rotinas › a rotina.
- Esperado: "Onde roda: este PC (Windows)…".
- Obtido: "seu Mac · precisa estar ligado e com o nod aberto". A rotina rodou mesmo assim.
- Causa provável: em `src/domain/onde-roda.ts` (`ondeRodaDaRotina`), quando não há alvo nem máquina Linux, o Windows é excluído (`!ehMaquinaDoMotor`), `maquina` fica null e `dependeDoMac` fica true. Daí `web/telas/agenda-rotinas.ts:240` cai no `?? "seu Mac"`. O caso "só Windows" precisa nomear o PC Windows.

**2. Hora da "Próxima vez" no fuso da máquina** (médio)
- Obtido: a rotina das 09:00 America/Sao_Paulo aparece como "12:00 hoje" (a VM está em UTC). O texto do chat diz "próxima execução: 25/11/2026, 09:00".
- Causa provável: `web/lib/agenda.ts:77` (`proximaVez`) usa `hora()` de `web/lib/render.ts:51`, que formata sem `timeZone`. Use o `fusoIana` da rotina (ou mostre os dois fusos).

**3. Data errada na fala do bot** (médio)
- O bot disse "O primeiro sai amanhã, 26/11, às 9h". Pelo fuso de São Paulo eram 23:41 de 24/11, então a próxima execução é 25/11, que é o que o sistema mostra.
- Causa provável: o contexto do agente traz a data e hora da máquina (UTC) e não o fuso da pessoa.

**4. Sem "Excluir" na tela de Rotinas** (médio)
- Passos: abra Configurações › Rotinas. Clique no "…" da rotina ativa: ele só expande o detalhe. Pause a rotina: o grupo das pausadas mostra só Ativar.
- Esperado: uma opção Excluir (com confirmação).
- Obtido: só dá para excluir pedindo ao bot na conversa.
- Código: `web/telas/agenda-rotinas.ts` (`acaoDaLinha` e `detalhe`) não tem ação de excluir. A única "Excluir rotina" está em `web/telas/sua-vez.ts:584`, que trata proposta.

**5. Botões por baixo do X** (médio, visual)
- "＋ Nova rotin…" e "Enviar feedbac…" ficam cortados pelo X de fechar do modal.
- Causa provável: o X tem posição absoluta e o `.ag-cab` (`web/agenda.css:10`), assim como o cabeçalho do Feedback, não reservam espaço à direita.

**6. Sem nod.log no Windows** (médio, diagnóstico)
- `desktop/main.ts:1600` chama `definirDestinoDoLog(criarArquivoDeLog({ dir: app.getPath("logs") }))`, mas `%APPDATA%\nod\logs` nem existe. O erro do destino é engolido em `src/obs/log.ts:45` (`try { destino?.(linha) } catch {}`).
- Suspeitas: `O_NOFOLLOW` e a checagem `ehRegularUnico`/modo 0600 em `desktop/diagnostico.ts:44-48` no Windows, ou o fluxo Windows não chega a esse ponto. O motor também não grava log próprio: roda em `conhost --headless` e o stdout se perde. Hoje só existem `instalador.log` e os logs do codex.

**7.** O texto vem de `web/lib/aparelho.ts:19` (`detalheDoTema`): ele trata só celular e desktop e assume macOS no desktop.

## Desempenho (Get-Process)
| Momento | nod.exe (4 proc.) | motor node | claude | CPU total | RAM livre |
|---|---|---|---|---|---|
| Antes de conversar | 116+49+65+159 MB | 52 MB | – | 4% | 5,0 GB |
| Durante uma resposta | 119+49+68+175 MB | 56 MB | 133→183 MB | 62–93% | 4,8 GB |
| Repouso, após reabrir | 147+100+60+49 MB | 46 MB | – | 7% | 5,1 GB |

Tempos: conversa simples ≤ 18 s e ~13 s; tarefa com arquivo ≤ 19 s; tarefa com anexo ≤ 19 s; "Testar agora" da rotina ~14 s; abertura a frio ~7 s (3,5 s de branco); motor religado ~10 s após cair.

### Análise de desempenho
- **O app em si é leve.** Parado, a janela (4 processos Electron) mais o motor somam ~400 MB, com CPU em ~5%. A tela cresceu de 159 para 177 MB na sessão, sem sinal de vazamento.
- **O gargalo é o Claude CLI a cada mensagem.** O `claude.exe` aparece com ~130–180 MB e some ao fim da resposta. Nesses segundos a CPU vai a 62–93% (2 vCPU). A partida a frio do CLI deve ser boa parte dos 13–18 s de uma resposta simples, e o Windows fica lento enquanto o bot responde.
- **Abertura a frio de ~7 s com ~3 s de tela branca.** Uma tela de carregamento (splash) já tira a sensação de travado.
- **Limite da medida:** os tempos vieram de prints a cada 4–6 s, então são tetos, não valores exatos. Próximo passo: medir o tempo até a primeira palavra e testar se manter o CLI aquecido entre mensagens corta a espera.

## Observações
- O X da janela só esconde o app na bandeja. "Sair" fecha a interface, mas o motor segue rodando (é o esperado para as rotinas).
- Quadro (kanban): não aparece para bots sem quadro. Testei a página Tarefas (Por bot / Por estado, Abertas, Feitas, Todas e Nova tarefa).
- Evidências: prints em [`prints/`](prints/) (seleção dos ~110 da rodada); números de desempenho colhidos com `Get-Process` e `Win32_Processor.LoadPercentage`.
