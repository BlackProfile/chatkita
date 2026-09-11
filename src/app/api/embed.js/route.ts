import { NextRequest, NextResponse } from "next/server";

/**
 * v52 (Task 68) — Widget embed ChatKita.
 *
 * Pemakaian: tempel satu baris ini di situs mana pun:
 *   <script src="https://ALAMAT-CHATKITA/api/embed.js" defer></script>
 *
 * Skrip menyuntik tombol chat melayang yang membuka ChatKita mode ringkas
 * (?embed=1) dalam iframe 380×620 di kanan bawah — chat 1-on-1 dengan admin
 * langsung dari website toko.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const js = `(function () {
  if (document.getElementById("chatkita-widget-root")) return;
  var origin = ${JSON.stringify(origin)};

  var btn = document.createElement("button");
  btn.id = "chatkita-widget-root";
  btn.setAttribute("aria-label", "Buka chat");
  btn.innerHTML = "&#128172;";
  btn.style.cssText = [
    "position:fixed", "right:20px", "bottom:20px", "z-index:2147483000",
    "width:56px", "height:56px", "border:none", "border-radius:9999px",
    "background:#059669", "color:#fff", "font-size:26px", "line-height:56px",
    "text-align:center", "cursor:pointer", "box-shadow:0 10px 30px rgba(5,150,105,.45)"
  ].join(";");

  var wrap = document.createElement("div");
  wrap.id = "chatkita-widget-panel";
  wrap.style.cssText = [
    "position:fixed", "right:20px", "bottom:88px", "z-index:2147483000",
    "width:380px", "max-width:calc(100vw - 32px)", "height:620px",
    "max-height:calc(100vh - 120px)", "border:none", "border-radius:18px",
    "overflow:hidden", "background:#fff", "display:none",
    "box-shadow:0 24px 70px rgba(0,0,0,.35)"
  ].join(";");

  var frame = document.createElement("iframe");
  frame.src = origin + "/?embed=1";
  frame.title = "ChatKita";
  frame.style.cssText = "width:100%;height:100%;border:none;display:block";
  frame.setAttribute("allow", "microphone; camera; clipboard-write");

  wrap.appendChild(frame);
  var open = false;
  btn.addEventListener("click", function () {
    open = !open;
    wrap.style.display = open ? "block" : "none";
    btn.innerHTML = open ? "&#10005;" : "&#128172;";
  });

  function mount() { document.body.appendChild(wrap); document.body.appendChild(btn); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else { mount(); }
})();`;

  return new NextResponse(js, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
