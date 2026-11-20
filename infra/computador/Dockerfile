# definido em 2026-10-22 (NOD-93): multi-arquitetura. `npm run computador:build` (scripts/computador/build.ts) constrói
# linux/arm64 e linux/amd64 pelo buildx a partir deste mesmo arquivo; o FROM fica sem --platform para cada build pegar
# a variante da plataforma pedida (TARGETPLATFORM). Todos os pacotes abaixo existem no Debian bookworm nas duas
# arquiteturas (o chromium inclusive), e o playwright-core do package.json é JS puro, sem binário nativo.
FROM node:24.19.0-bookworm-slim AS bundle
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src/domain/ ./src/domain/
COPY infra/computador/ ./infra/computador/
# supervisor/tela/terminal importam a régua de memória do domínio. O bundle fecha esse grafo dentro da imagem; copiar
# só os .mjs deixava regua.mjs apontando para /src/domain, que não existe no runtime.
RUN npx esbuild infra/computador/supervisor.mjs infra/computador/tela.mjs infra/computador/terminal.mjs --bundle --platform=node --target=node24 --format=esm --outdir=/bundle --out-extension:.js=.mjs --external:playwright-core --banner:js="import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);"

FROM node:24.19.0-bookworm-slim
ARG TARGETARCH
LABEL org.opencontainers.image.title="nod-computador" app.nod.computador.arch="${TARGETARCH}"
RUN apt-get update && apt-get install -y --no-install-recommends chromium xvfb x11vnc openbox tint2 feh pcmanfm xfce4-terminal xdotool scrot xclip dbus-x11 pulseaudio ffmpeg python3 python3-venv git curl xterm fonts-liberation ca-certificates bubblewrap && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends gnome-keyring libsecret-1-0 libsecret-tools && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/nod
COPY infra/computador/package*.json ./
RUN npm ci --omit=dev
COPY infra/computador/*.mjs ./
COPY --from=bundle /bundle/*.mjs ./
COPY infra/computador/shell-visual/ ./shell-visual/
RUN mkdir -p /workspace /home/node/.config && chown -R node:node /workspace /home/node
USER node
ENV HOME=/home/node NOD_PC_RAIZ=/home/node/computadores NOD_PC_WORKSPACE_RAIZ=/workspace NOD_PC_RUN=/tmp/nod-pc NOD_PC_SOCKET=/tmp/nod-computer.sock NOD_PC_TERMINAL=/tmp/nod-pc/term.sock NOD_PC_TELA=/opt/nod/tela.mjs NOD_PC_CHROMIUM=/usr/bin/chromium NOD_SHELL_VISUAL=paper-v2 NOD_SHELL_VISUAL_PACOTE=/opt/nod/shell-visual/paper-v2 NOD_SHELL_VISUAL_ESTADO=/home/node/.local/state/nod/shell-visual HTTP_PROXY=http://egress:3128 HTTPS_PROXY=http://egress:3128 http_proxy=http://egress:3128 https_proxy=http://egress:3128 NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
CMD ["node", "docker-runtime.mjs"]
