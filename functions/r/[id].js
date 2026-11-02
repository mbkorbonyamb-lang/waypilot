// Cloudflare Pages : waypilot.wayzure.com/r/<id> affiche le lien d'aperçu stocké par le relais.
// Le prospect reçoit ainsi une adresse au nom du site, pas une adresse workers.dev.
const RELAIS = "https://waypilot-relais.wayzure.workers.dev";

export async function onRequestGet({ params }) {
  const id = String(params.id || "");
  if (!/^[A-Za-z0-9]{12}$/.test(id)) return new Response("Rapport introuvable.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const r = await fetch(`${RELAIS}/r/${id}`);
  return new Response(r.body, { status: r.status, headers: r.headers });
}
