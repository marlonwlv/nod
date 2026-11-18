# nod 1.0.0-rc.8

Oitava candidata da 1.0.0. Ela leva o desenvolvimento para o repositório público, amadurece o uso do Nod por times e corrige a instalação e os turnos no Windows. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.8/docs/release-desktop.md).

## O que entra nesta versão (desde a rc.7, 9/11)

- **Repositório e release públicos** ([#1](https://github.com/marlonwlv/nod/pull/1), [#6](https://github.com/marlonwlv/nod/pull/6)): desenvolvimento e deploy passam a sair de `marlonwlv/nod`; o workflow isolado gera Mac arm64/x64 e Windows x64 em runners hospedados, mantém segredos no environment `release`, oferece modo seco e nunca sobrescreve artefatos publicados.
- **Turnos com prompt e catálogo grandes abrem no Windows** ([#39](https://github.com/marlonwlv/nod/pull/39), [#57](https://github.com/marlonwlv/nod/pull/57)): dados volumosos vão para arquivos temporários e o proxy escopado deixa de repetir a lista de ferramentas na linha de comando; falha síncrona de `spawn` agora vira diagnóstico acionável.
- **Instalador Windows mais seguro e recuperável** ([#40](https://github.com/marlonwlv/nod/pull/40)): confere os hashes oficiais do Node, serializa instalações concorrentes, recupera trava abandonada, remove inicialização legada, confirma que o motor iniciou e preserva os shims nativos. O app também ganhou microfone e atalho para as Configurações ([#137](https://github.com/marlonwlv/nod/pull/137)).
- **Quadro e trabalhos para times** ([#5](https://github.com/marlonwlv/nod/pull/5), [#16](https://github.com/marlonwlv/nod/pull/16)): cada tarefa tem um trabalho próprio, o mesmo bot reaproveita a sessão entre etapas seguidas e o quadro ganhou a rodada visual Multica.
- **Rotinas e colaboração mais confiáveis** ([#13](https://github.com/marlonwlv/nod/pull/13), [#15](https://github.com/marlonwlv/nod/pull/15), [#118](https://github.com/marlonwlv/nod/pull/118)): pausa com retomada automática, execução imediata pelo chat e teto para pedidos de colega ou rotinas presos nos bastidores.
- **Entrada e uso no celular** ([#83](https://github.com/marlonwlv/nod/pull/83), [#85](https://github.com/marlonwlv/nod/pull/85)): a pessoa escolhe entre entrar e criar um espaço provisório, pode conectar o celular por QR code e ganhou alvos de toque maiores nas áreas críticas.
- **VM local mais rápida de produzir** ([#154](https://github.com/marlonwlv/nod/pull/154)): o disco agora é montado em loop e preparado por `chroot`, reduzindo o tempo observado no arm64 de 44 para 2,5 minutos.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.8 / v1.0.0-rc.8 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.8-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.8/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.8-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac ok nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente (instalar, onboarding, microfone, abrir turno com quatro conectores e remover pelo desinstalador)
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.7)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução; se o navegador não abrir ao clicar em Entrar, rode o comando no PowerShell (o cartão mostra qual). Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: Windows continua sem assinatura (NOD-471); falta concluir os aceites nas duas arquiteturas do Mac e no Windows antes de publicar o rascunho.
```

Aceite Intel/ARM/Windows: pendente.
