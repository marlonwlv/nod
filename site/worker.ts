const HOST_CANONICO = "nodbot.ai";
const HOST_WWW = `www.${HOST_CANONICO}`;

type Assets = { fetch(request: Request): Promise<Response> };

export function destinoCanonico(entrada: string): URL | null {
  const url = new URL(entrada);
  if (url.hostname.toLowerCase() !== HOST_WWW) return null;
  url.protocol = "https:";
  url.hostname = HOST_CANONICO;
  url.port = "";
  return url;
}

export default {
  fetch(request: Request, env: { ASSETS: Assets }): Response | Promise<Response> {
    const destino = destinoCanonico(request.url);
    if (destino) return Response.redirect(destino, 301);
    return env.ASSETS.fetch(request);
  },
};
