# Shell visual do computador

Este diretório recebe o bundle exportado do Paper do Gil. A NOD-497 deixa a infraestrutura pronta, mas não inclui
aparência provisória: sem `manifesto.json`, `NOD_SHELL_VISUAL` permanece `desligado` e o desktop atual continua ativo.

O bundle aprovado traz um `manifesto.json` de schema 1, os três papéis visuais (`openbox`, `tint2`, `wallpaper`), os
launchers reais (`browser`, `files`, `terminal`), checksums SHA-256 e os breakpoints de QA. Docker e Orgo instalam
exatamente este mesmo diretório; a ativação é atômica, idempotente e mantém a versão anterior para recuperação.

Nenhum asset ou marca do Bot HQ pode entrar aqui.
