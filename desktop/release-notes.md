# nod 1.0.0-rc.10

Décima candidata da 1.0.0. O destaque é o **navegador próprio do bot**: um Chrome só dele, que a pessoa assiste ao vivo ao lado da conversa e pode assumir e devolver. O app do Mac passa a levar o binário do navegador no pacote. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471); o navegador do bot ainda não roda no app do PC. Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.10/docs/release-desktop.md).

## O que entra nesta versão (desde a rc.9, 19/11)

- **O navegador do bot** ([#243](https://github.com/marlonwlv/nod/pull/243), ADR-190): o bot navega num Chrome próprio, separado do computador dele. A pessoa assiste ao vivo no painel, numa aba, em tela cheia ou no celular, e assume e devolve o controle pela pílula. A aprovação só aparece no ponto sem volta (pagar, apagar, enviar), trocar senha ou segurança da conta é sempre a pessoa, e os logins entram sem o bot ver a senha (cofre do nod, 1Password, Bitwarden e "Trazer do meu Chrome" pelo app do Mac). Dá para ensinar uma tarefa gravando os passos, que vira Habilidade.
- **Seguir conversando dispensa o cartão aberto** ([#272](https://github.com/marlonwlv/nod/pull/272), ADR-191): o cartão que esperava um clique fecha quando a pessoa manda uma mensagem nova.
- **Quadro como no Paper** ([#253](https://github.com/marlonwlv/nod/pull/253)): Feito e Cancelado começam recolhidos e o card ganha o desenho novo.
- **Tarefas e Threads por baixo** ([#292](https://github.com/marlonwlv/nod/pull/292) a [#300](https://github.com/marlonwlv/nod/pull/300), ADR-192): o modelo novo de Tarefa com Thread, com backfill e a leitura nova atrás de flag.
- **Mais telas em React** ([#211](https://github.com/marlonwlv/nod/pull/211) a [#230](https://github.com/marlonwlv/nod/pull/230), ADR-179): a grade do quadro, oito telas da conversa, diálogos, a paleta ⌘K, o campo de mensagem e os Conectores avançados.
- **Correções**: o motor não reinicia em laço na troca de arquivo ([#245](https://github.com/marlonwlv/nod/pull/245)), a sessão do Claude vem de outra conta da máquina ([#248](https://github.com/marlonwlv/nod/pull/248)), as rodadas de QA de rotinas, acessos, bots e decisões (QA-105 a QA-120) e os alvos de toque no celular.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.10 / v1.0.0-rc.10 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.10-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.10/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.10-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.9)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
