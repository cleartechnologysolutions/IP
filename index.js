const IPWHOIS_ENDPOINT = "https://ipwho.is/";
const RIPESTAT_PREFIXES_ENDPOINT = "https://stat.ripe.net/data/announced-prefixes/data.json";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getIpVersion(ip) {
  if (!ip) return "Unknown";
  return ip.includes(":") ? "IPv6" : "IPv4";
}

function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    ""
  );
}

async function fetchJson(url, timeoutMs = 2200) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ClearIP/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getIpEnrichment(ip, asnNumber) {
  const enrichment = {
    isp: "",
    organization: "",
    asn: "",
    prefixes: [],
    prefixCount: 0,
    notes: [],
  };

  if (ip) {
    try {
      const ipInfo = await fetchJson(`${IPWHOIS_ENDPOINT}${encodeURIComponent(ip)}`, 2500);
      if (ipInfo.success === false) throw new Error(ipInfo.message || "lookup failed");
      enrichment.isp = ipInfo.connection?.isp || "";
      enrichment.organization = ipInfo.connection?.org || "";
      enrichment.asn = ipInfo.connection?.asn || "";
    } catch (error) {
      enrichment.notes.push(`ISP lookup failed: ${error.message || "unknown error"}`);
    }
  }

  if (asnNumber) {
    try {
      const url = new URL(RIPESTAT_PREFIXES_ENDPOINT);
      url.searchParams.set("resource", `AS${asnNumber}`);
      const routeInfo = await fetchJson(url, 3000);
      const prefixes = routeInfo.data?.prefixes || [];
      enrichment.prefixCount = prefixes.length;
      enrichment.prefixes = prefixes
        .map((item) => item.prefix)
        .filter(Boolean)
        .slice(0, 30);
    } catch (error) {
      enrichment.notes.push(`ASN prefix lookup failed: ${error.message || "unknown error"}`);
    }
  }

  return enrichment;
}

async function getRequestDetails(request) {
  const cf = request.cf || {};
  const ip = getClientIp(request);
  const asnNumber = cf.asn || 0;
  const enrichment = await getIpEnrichment(ip, asnNumber);
  const isp = enrichment.isp || enrichment.organization || cf.asOrganization || "Unknown";
  const asn = enrichment.asn ? `AS${enrichment.asn}` : asnNumber ? `AS${asnNumber}` : "Unknown";

  return {
    ip,
    version: getIpVersion(ip),
    isp,
    asn,
    asOrganization: enrichment.organization || cf.asOrganization || "Unknown",
    prefixCount: enrichment.prefixCount,
    prefixes: enrichment.prefixes,
    notes: enrichment.notes,
    country: cf.country || "Unknown",
    city: cf.city || "Unknown",
    region: cf.region || "Unknown",
    regionCode: cf.regionCode || "Unknown",
    postalCode: cf.postalCode || "Unknown",
    timezone: cf.timezone || "Unknown",
    colo: cf.colo || "Unknown",
    userAgent: request.headers.get("user-agent") || "Unknown",
  };
}

async function jsonResponse(request) {
  const details = await getRequestDetails(request);
  return Response.json(details, {
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function textResponse(request) {
  return new Response(`${getClientIp(request)}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function pageResponse(request) {
  const details = await getRequestDetails(request);
  const rows = [
    ["ISP / network", details.isp],
    ["ASN org", details.asOrganization],
    ["ASN", details.asn],
    ["IP version", details.version],
    ["Country", details.country],
    ["Region", details.region],
    ["Region code", details.regionCode],
    ["City", details.city],
    ["Postal code", details.postalCode],
    ["Timezone", details.timezone],
    ["Cloudflare colo", details.colo],
  ];
  const prefixText = details.prefixes.length
    ? details.prefixes.join("\n")
    : "No announced prefixes returned.";
  const prefixSummary = details.prefixCount > details.prefixes.length
    ? `Showing first ${details.prefixes.length} of ${details.prefixCount} announced prefixes.`
    : `${details.prefixCount} announced prefixes found.`;
  const notesText = details.notes.length ? details.notes.join("\n") : "No lookup notes.";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clear IP | Clear Technology Solutions</title>
  <meta name="description" content="See your public IP address.">
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #07111d;
      color: #f8fafc;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top right, rgba(34, 211, 238, 0.16), transparent 34rem),
        linear-gradient(180deg, #07111d 0%, #0b1625 100%);
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 20px 0 48px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px;
      border: 1px solid rgba(103, 232, 249, 0.22);
      border-radius: 8px;
      background: #0d1a29;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border: 1px solid rgba(165, 243, 252, 0.72);
      border-radius: 8px;
      background: rgba(34, 211, 238, 0.15);
      color: white;
      font-weight: 900;
      letter-spacing: 0.08em;
      box-shadow: inset 0 0 24px rgba(103, 232, 249, 0.12);
    }
    .brand-title {
      margin: 0;
      font-size: 18px;
      line-height: 1.1;
      font-weight: 900;
    }
    .brand-subtitle {
      margin: 4px 0 0;
      color: rgba(207, 250, 254, 0.82);
      font-size: 14px;
      font-weight: 600;
    }
    .refresh {
      border: 1px solid rgba(103, 232, 249, 0.42);
      border-radius: 8px;
      padding: 10px 14px;
      background: rgba(34, 211, 238, 0.1);
      color: #cffafe;
      text-decoration: none;
      font-size: 14px;
      font-weight: 800;
    }
    .layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 20px;
      margin-top: 20px;
    }
    .panel {
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
    }
    .side {
      padding: 20px;
    }
    h1 {
      margin: 0;
      font-size: 34px;
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .side p {
      margin: 14px 0 0;
      color: #cbd5e1;
      font-size: 15px;
      line-height: 1.65;
    }
    .links {
      display: grid;
      gap: 10px;
      margin-top: 24px;
    }
    .links a {
      display: block;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #e0f2fe;
      text-decoration: none;
      font-weight: 800;
      background: rgba(2, 6, 23, 0.35);
    }
    .result {
      padding: 24px;
    }
    .label {
      margin: 0;
      color: #a5f3fc;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .ip {
      margin: 14px 0 0;
      overflow-wrap: anywhere;
      color: white;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: clamp(36px, 7vw, 76px);
      line-height: 1.05;
      font-weight: 900;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }
    button, .button {
      border: 0;
      border-radius: 8px;
      padding: 12px 16px;
      background: #22d3ee;
      color: #06111f;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 900;
      text-decoration: none;
    }
    .button.secondary {
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: transparent;
      color: #f8fafc;
    }
    .details {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 24px;
    }
    .detail {
      min-width: 0;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(2, 6, 23, 0.32);
    }
    .detail span {
      display: block;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .detail strong {
      display: block;
      margin-top: 6px;
      overflow-wrap: anywhere;
      color: #f8fafc;
      font-size: 17px;
    }
    .agent {
      margin-top: 18px;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(2, 6, 23, 0.32);
      color: #94a3b8;
      overflow-wrap: anywhere;
      font-size: 13px;
      line-height: 1.5;
    }
    .console {
      margin: 18px 0 0;
      padding: 14px;
      border: 1px solid rgba(103, 232, 249, 0.18);
      border-radius: 8px;
      background: rgba(2, 6, 23, 0.48);
    }
    .console span {
      display: block;
      color: #a5f3fc;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .console pre {
      margin: 10px 0 0;
      max-height: 220px;
      overflow: auto;
      white-space: pre;
      color: #dbeafe;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.55;
    }
    @media (max-width: 860px) {
      .layout {
        grid-template-columns: 1fr;
      }
      header {
        align-items: flex-start;
      }
      .details {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">
        <div class="mark">CTS</div>
        <div>
          <p class="brand-title">Clear Technology Solutions</p>
          <p class="brand-subtitle">Clear IP</p>
        </div>
      </div>
      <a class="refresh" href="/">Refresh</a>
    </header>

    <section class="layout">
      <aside class="panel side">
        <h1>Clear IP</h1>
        <p>See the public IP address this site sees from your current connection.</p>
        <div class="links">
          <a href="/raw">Plain text IP</a>
          <a href="/json">JSON details</a>
        </div>
      </aside>

      <section class="panel result">
        <p class="label">Your public IP</p>
        <p class="ip" id="ip">${escapeHtml(details.ip || "Unknown")}</p>
        <div class="actions">
          <button type="button" id="copy">Copy IP</button>
          <a class="button secondary" href="/raw">Open raw</a>
        </div>

        <div class="details">
          ${rows
            .map(
              ([label, value]) => `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
            )
            .join("")}
        </div>

        <div class="agent">
          <strong>User agent:</strong> ${escapeHtml(details.userAgent)}
        </div>

        <div class="console">
          <span>ISP / ASN prefixes</span>
          <pre>${escapeHtml(prefixSummary)}\n\n${escapeHtml(prefixText)}</pre>
        </div>

        <div class="console">
          <span>Lookup notes</span>
          <pre>${escapeHtml(notesText)}</pre>
        </div>
      </section>
    </section>
  </main>
  <script>
    const copyButton = document.getElementById("copy");
    copyButton?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById("ip")?.textContent?.trim() || "");
        copyButton.textContent = "Copied";
        window.setTimeout(() => {
          copyButton.textContent = "Copy IP";
        }, 1400);
      } catch {
        copyButton.textContent = "Copy failed";
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/raw" || url.pathname === "/text") {
      return textResponse(request);
    }

    if (url.pathname === "/json" || url.pathname === "/api/ip") {
      return jsonResponse(request);
    }

    return pageResponse(request);
  },
};
