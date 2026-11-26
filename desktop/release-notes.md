# nod 1.0.0-rc.14

Décima quarta candidata da 1.0.0, para corrigir o bloqueante da rc.13 no Windows. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). O motor do Windows passa a se atualizar sozinho de verdade ([#380](https://github.com/marlonwlv/nod/pull/380)); quem está na rc.13 recebe pelo atualizador do app. Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.14/docs/release-desktop.md).

## O que entra desde a rc.13 (25/11)

- **O motor do Windows se atualiza sozinho de verdade** ([#380](https://github.com/marlonwlv/nod/pull/380)): na rc.13 o motor iniciado com `detached: true` não conseguia se trocar sozinho (bloqueante do [#358](https://github.com/marlonwlv/nod/pull/358)); agora o app e o motor iniciam o processo sem `detached` e a troca acontece. O motor também grava log em `%LOCALAPPDATA%\nod\motor.log`. Quem está na rc.13 recebe pelo atualizador do app.
- **Cofre cifrado e redesenhado** ([#334](https://github.com/marlonwlv/nod/pull/334), [#359](https://github.com/marlonwlv/nod/pull/359)): cofre cifrado em envelope por tenant, com a chave mestra no Cloud KMS (ADR-195, entrega 1), e Configurações › Cofre no novo desenho.
- **Mais de uma conta do mesmo app do Marketplace** ([#372](https://github.com/marlonwlv/nod/pull/372)) (ADR-196).
- **Navegador** ([#316](https://github.com/marlonwlv/nod/pull/316), [#314](https://github.com/marlonwlv/nod/pull/314), [#326](https://github.com/marlonwlv/nod/pull/326), [#340](https://github.com/marlonwlv/nod/pull/340), [#344](https://github.com/marlonwlv/nod/pull/344)): trocar de aba não solta a trava da senha do cofre, a cerca do navegador do bot recusa nomes com ponto final e IPv6 que embute IPv4 interno, download que estoura o prazo é cancelado, nome de download com extensão sem sobrescrever repetido, cofre e navegador fora do `nod_chamar_rota`.
- **Tarefas, quadro e turnos** ([#302](https://github.com/marlonwlv/nod/pull/302), [#271](https://github.com/marlonwlv/nod/pull/271), [#258](https://github.com/marlonwlv/nod/pull/258), [#352](https://github.com/marlonwlv/nod/pull/352), [#351](https://github.com/marlonwlv/nod/pull/351), [#347](https://github.com/marlonwlv/nod/pull/347), [#338](https://github.com/marlonwlv/nod/pull/338)): Resolver/Arquivar com execução viva, filtro de bot que saiu vale como Todos, vista e filtros que ficam ao voltar, renomes simultâneos sem quadro duplicado, entrega tardia que mantém as esperas, "iniciou" repetido que não conta queda e sucessão de chave que leva o Desfazer.
- **Cliques duplos e cartões** ([#289](https://github.com/marlonwlv/nod/pull/289), [#286](https://github.com/marlonwlv/nod/pull/286), [#288](https://github.com/marlonwlv/nod/pull/288), [#280](https://github.com/marlonwlv/nod/pull/280), [#269](https://github.com/marlonwlv/nod/pull/269), [#240](https://github.com/marlonwlv/nod/pull/240), [#360](https://github.com/marlonwlv/nod/pull/360)): Gerar token, Criar rotina, Criar sala e Conceder não gravam dois, Revogar do grupo pega a trava do par, excluir time já mudado, troca de modo e Anotar repetidos gravam uma vez só, cartão do limite com voz certa.
- **Interface e acessibilidade** ([#378](https://github.com/marlonwlv/nod/pull/378), [#379](https://github.com/marlonwlv/nod/pull/379), [#265](https://github.com/marlonwlv/nod/pull/265), [#264](https://github.com/marlonwlv/nod/pull/264), [#267](https://github.com/marlonwlv/nod/pull/267), [#259](https://github.com/marlonwlv/nod/pull/259), [#263](https://github.com/marlonwlv/nod/pull/263), [#268](https://github.com/marlonwlv/nod/pull/268), [#273](https://github.com/marlonwlv/nod/pull/273), [#285](https://github.com/marlonwlv/nod/pull/285), [#335](https://github.com/marlonwlv/nod/pull/335)): seletor de IA do campo volta a abrir, nome longo do bot não sai da pílula, foco que não cai no `<body>` em Sua vez, Conectores, Não lidos, pílula e anexos, setas no Para: da nova conversa, Limpar vencidos que relê a tela, filtro da Agenda, nome do bot sem artigo e releitura com espera após 5xx.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.14 / v1.0.0-rc.14 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.14-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.14/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.14-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.13)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
