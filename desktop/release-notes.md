# nod 1.0.0-rc.13

Décima terceira candidata da 1.0.0: o **motor do Windows passa a se atualizar sozinho**. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). A correção do motor só vale depois que o app do Windows estiver na rc.13 (pela atualização automática ou instalando de novo); daí em diante ninguém precisa rodar `irm https://nodbot.ai/windows | iex` para o motor acompanhar o servidor. Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.13/docs/release-desktop.md).

## O que entra desde a rc.12 (25/11)

- **O motor do Windows se atualiza sozinho** ([#358](https://github.com/marlonwlv/nod/pull/358)): antes o motor só mudava quando a pessoa rodava de novo o comando de instalação, e quem tinha motor antigo ficava sem recursos novos (como o navegador do bot). Agora o motor novo troca a si mesmo quando o servidor publica versão nova, esperando os turnos da pessoa, e o app do Windows confere o motor contra o manifesto do servidor ao abrir e a cada 30 min, trocando o motor antigo que não sabe se atualizar. `NOD_ATUALIZAR_SOZINHO=0` desliga.
- **A troca do motor não corta o turno da pessoa** ([#365](https://github.com/marlonwlv/nod/pull/365)): o motor que sabe se atualizar avisa o app a cada 5 min, e o app não troca por cima dele enquanto ele espera um turno longo terminar.
- **Navegador** ([#317](https://github.com/marlonwlv/nod/pull/317), [#315](https://github.com/marlonwlv/nod/pull/315), [#329](https://github.com/marlonwlv/nod/pull/329), [#332](https://github.com/marlonwlv/nod/pull/332), [#341](https://github.com/marlonwlv/nod/pull/341), [#369](https://github.com/marlonwlv/nod/pull/369)): download direto em pedaços com teto de 200 MB, stream do agent-browser só ligado quando alguém usa, pasta dos sockets conferida a cada comando, login apagado do cofre sai do cartão aberto e tarefa ensinada não escolhe calada entre nomes parecidos.
- **Tarefas, quadro e frentes** ([#281](https://github.com/marlonwlv/nod/pull/281), [#303](https://github.com/marlonwlv/nod/pull/303), [#313](https://github.com/marlonwlv/nod/pull/313), [#345](https://github.com/marlonwlv/nod/pull/345), [#346](https://github.com/marlonwlv/nod/pull/346), [#350](https://github.com/marlonwlv/nod/pull/350), [#354](https://github.com/marlonwlv/nod/pull/354), [#257](https://github.com/marlonwlv/nod/pull/257), [#266](https://github.com/marlonwlv/nod/pull/266), [#274](https://github.com/marlonwlv/nod/pull/274), [#301](https://github.com/marlonwlv/nod/pull/301)): Nova tarefa sem duplicar no reenvio, contador da barra igual à tela Tarefas, arquivadas que releem, tarefa de bot excluído explicada, filtros e foco do quadro.
- **Cartões e ações repetidas devolvem o mesmo resultado** ([#236](https://github.com/marlonwlv/nod/pull/236), [#247](https://github.com/marlonwlv/nod/pull/247), [#249](https://github.com/marlonwlv/nod/pull/249), [#251](https://github.com/marlonwlv/nod/pull/251), [#254](https://github.com/marlonwlv/nod/pull/254), [#255](https://github.com/marlonwlv/nod/pull/255), [#305](https://github.com/marlonwlv/nod/pull/305), [#348](https://github.com/marlonwlv/nod/pull/348), [#349](https://github.com/marlonwlv/nod/pull/349)): pedir_aprovacao, atualizar_rotina, atualizar_perfil, substituir_colunas e outros não abrem card duplicado; os cartões de desvio dizem a verdade.
- **Nomes ambíguos pedem o id** ([#250](https://github.com/marlonwlv/nod/pull/250), [#366](https://github.com/marlonwlv/nod/pull/366), [#367](https://github.com/marlonwlv/nod/pull/367), [#368](https://github.com/marlonwlv/nod/pull/368)): gerir_maquinas, nao_lidos, ajustar_navegador, pedir_a_pessoa e gerir_apps não escolhem calados entre bots de nome igual.
- **Cofre, memória, segredos e acessos** ([#311](https://github.com/marlonwlv/nod/pull/311), [#323](https://github.com/marlonwlv/nod/pull/323), [#238](https://github.com/marlonwlv/nod/pull/238), [#239](https://github.com/marlonwlv/nod/pull/239), [#283](https://github.com/marlonwlv/nod/pull/283), [#284](https://github.com/marlonwlv/nod/pull/284), [#234](https://github.com/marlonwlv/nod/pull/234), [#279](https://github.com/marlonwlv/nod/pull/279), [#260](https://github.com/marlonwlv/nod/pull/260)): mesma senha não duplica login, teto de 2.000 caracteres na memória, tokens do MCP e do turno redigidos, acesso não fica em bot excluído.
- **Robustez do servidor** ([#246](https://github.com/marlonwlv/nod/pull/246), [#252](https://github.com/marlonwlv/nod/pull/252), [#270](https://github.com/marlonwlv/nod/pull/270), [#275](https://github.com/marlonwlv/nod/pull/275), [#278](https://github.com/marlonwlv/nod/pull/278), [#282](https://github.com/marlonwlv/nod/pull/282), [#290](https://github.com/marlonwlv/nod/pull/290), [#304](https://github.com/marlonwlv/nod/pull/304), [#242](https://github.com/marlonwlv/nod/pull/242), [#256](https://github.com/marlonwlv/nod/pull/256)): tetos sob pedidos em paralelo, sem deadlock entre mensagem e Confirmar, 404 em vez de 500 para bot excluído, hora da volta do limite com horário de verão.
- **Acessibilidade e textos da interface** ([#261](https://github.com/marlonwlv/nod/pull/261), [#262](https://github.com/marlonwlv/nod/pull/262), [#276](https://github.com/marlonwlv/nod/pull/276), [#277](https://github.com/marlonwlv/nod/pull/277), [#342](https://github.com/marlonwlv/nod/pull/342), [#343](https://github.com/marlonwlv/nod/pull/343), [#353](https://github.com/marlonwlv/nod/pull/353), [#356](https://github.com/marlonwlv/nod/pull/356)): foco que não cai no `<body>`, contraste AA, nome do bot sem artigo, Esc da apresentação só vindo do iframe dela.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.13 / v1.0.0-rc.13 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.13-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.13/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.13-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.12)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
