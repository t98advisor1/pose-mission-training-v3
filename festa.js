/* 페스타 전용: 운영자 로그인(행사 기기만 업로드·랭킹 기록 권한) + 선택 사진 20분 QR 수령 */
(function () {
    const W = "https://pose-photo-pickup-v3.indosupervisor0126.workers.dev";
    // 운영자 로그인(랭킹 기록 권한 발급)은 기존 워커를 그대로 사용 - 비밀값을 새 워커로 옮기지 않기 위함
    const LOGIN_W = "https://pose-photo-pickup-test.indosupervisor0126.workers.dev";
    const KEY = "FESTA_OP_TOKEN";
    const MAX_BYTES = 3800000;
    const token = () => { try { const t = sessionStorage.getItem(KEY) || ""; return Number(t.split(".")[0]) > Date.now() / 1000 ? t : ""; } catch (e) { return ""; } };
    window.FestaOp = { token, worker: W };

    function $(id) { return document.getElementById(id); }
    function refreshOpUI() {
        const on = !!token();
        if ($("op-state")) $("op-state").textContent = on ? "운영자 로그인됨 (이 기기만, 최대 6시간)" : "로그인 전: 점수 기록은 꺼져 있어요 (사진 QR은 로그인 없이 가능)";
        if ($("op-logout")) $("op-logout").style.display = on ? "inline-block" : "none";
        if ($("op-login")) $("op-login").style.display = on ? "none" : "inline-block";
        if ($("op-pin")) $("op-pin").style.display = on ? "none" : "inline-block";
        updateQrState();
    }
    function missing() {
        const m = [];
        if (!(window.getPickedShots ? window.getPickedShots() : []).length) m.push("사진을 한 장 이상 고르세요");
        const c = $("shots-consent"); if (!c || !c.checked) m.push("20분 임시 저장 안내에 체크하세요");
        return m;
    }
    function updateQrState() {
        const q = $("shots-qr-btn"), n = $("shots-qr-note"); if (!q || !n) return;
        const m = missing(), ok = !m.length;
        q.style.background = ok ? "#7c3aed" : "#9ca3af";
        n.style.cssText = "margin:6px 0 0;font-size:1rem;font-weight:700;color:" + (ok ? "#166534" : "#b91c1c");
        n.textContent = ok ? "준비됐어요. 눌러서 QR을 만드세요." : "QR을 만들려면: " + m.join(" / ");
    }
    document.addEventListener("change", () => setTimeout(updateQrState, 0));
    document.addEventListener("click", () => setTimeout(updateQrState, 0));
    async function login() {
        const pin = $("op-pin").value; $("op-pin").value = "";
        $("op-msg").textContent = "확인 중...";
        try {
            const r = await fetch(LOGIN_W + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
            if (r.status === 429) { $("op-msg").textContent = "요청이 많아요. 잠시 후 다시 시도해 주세요."; return; }
            if (!r.ok) { $("op-msg").textContent = "비밀번호가 맞지 않아요."; return; }
            sessionStorage.setItem(KEY, (await r.json()).token);
            $("op-msg").textContent = "";
            window.dispatchEvent(new CustomEvent("festa-op-login"));
        } catch (e) { $("op-msg").textContent = "연결하지 못했어요. 인터넷을 확인해 주세요."; }
        refreshOpUI();
    }
    function logout() { try { sessionStorage.removeItem(KEY); } catch (e) {} refreshOpUI(); }
    const blobToDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });

    let qrLoaded = null;
    function loadQr() { return qrLoaded || (qrLoaded = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "qr.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); })); }

    async function sendQr() {
        const msg = $("shots-msg"), area = $("shots-qr-area");
        const picked = window.getPickedShots ? window.getPickedShots() : [];
                if (!picked.length) { msg.textContent = "받을 사진을 먼저 선택해 주세요."; return; }
        if (!$("shots-consent").checked) { msg.textContent = "임시 저장 안내를 확인하고 체크해 주세요."; return; }
        msg.textContent = "사진을 보내는 중...";
        try {
            const urls = [];
            for (const x of picked) urls.push(await blobToDataUrl(await (await fetch(x.url)).blob()));
            if (urls.some(u => !u.startsWith("data:image/jpeg;base64,"))) throw new Error("format");
            const body = '{"photos":["' + urls.join('","') + '"]}';
            if (body.length > MAX_BYTES) { msg.textContent = "사진이 너무 커요. 장수를 줄여 다시 선택해 주세요."; return; }
            const r = await fetch(W + "/api/save", { method: "POST", headers: { "Content-Type": "application/json", ...(token() ? { "Authorization": "Bearer " + token() } : {}) }, body });
            if (r.status === 429) { msg.textContent = "지금 사용자가 많아요. 잠시 뒤 다시 눌러 주세요."; return; }
            if (!r.ok) { msg.textContent = "서버에 임시 저장하지 못했어요. 대신 '선택한 사진 저장'으로 이 기기에 저장해 주세요."; return; }
            const j = await r.json();
            await loadQr();
            const q = qrcode(0, "M"); q.addData(j.url); q.make();
            area.innerHTML = '<div style="background:#fff;padding:8px;border-radius:10px;display:inline-block">' + q.createSvgTag(5) + '</div>';
            const p = document.createElement("p"); p.style.cssText = "font-size:.8rem;margin:6px 0 0;word-break:break-all"; p.textContent = "휴대폰 카메라로 QR을 찍으세요. " + (j.minutes || 20) + "분 동안만 받을 수 있어요."; area.appendChild(p);
            { const nn = $("shots-qr-note"); if (nn) { nn.style.color = "#166534"; nn.textContent = "QR이 만들어졌어요. 아래 QR을 휴대폰 카메라로 찍어 주세요."; } }
            msg.textContent = picked.length + "장을 서버에 임시 저장했어요. 휴대폰에서 다운로드 페이지가 열리는지, 갤러리에 저장됐는지는 직접 확인해 주세요.";
        } catch (e) { msg.textContent = "보내지 못했어요. 대신 '선택한 사진 저장'으로 이 기기에 저장해 주세요."; }
    }
    function mount() {
        const box = $("shots-gallery-box");
        if (box && !$("shots-qr-btn")) {
            const dl = $("shots-download-btn");
            const wrap = document.createElement("div");
            wrap.innerHTML = '<label style="display:block;margin-top:10px;font-size:.8rem;line-height:1.4"><input type="checkbox" id="shots-consent"> QR로 받으면 고른 사진이 서버에 20분 동안 임시 저장되는 것을 확인했어요. 20분이 지나면 이 주소로 받을 수 없게 되고 서버에서도 지워지도록 설정돼 있지만, 실제로 지워지는 시각은 보장하지 않아요. 얼굴이 나온 사진이니 원할 때만 눌러 주세요.</label>' +
                '<button id="shots-qr-btn" type="button" style="width:100%;margin-top:8px;padding:10px;border:0;border-radius:10px;background:#7c3aed;color:#fff;font-weight:700">선택한 사진 QR로 받기 (20분)</button>' +
                '<p id="shots-qr-note" style="margin:4px 0 0;font-size:.8rem;color:#92400e"></p><div id="shots-qr-area" style="text-align:center;margin-top:8px"></div>';
            dl.insertAdjacentElement("afterend", wrap);
            $("shots-qr-btn").onclick = sendQr;
            refreshOpUI();
        }
        if ($("op-login") && !$("op-login").dataset.b) { $("op-login").dataset.b = 1; $("op-login").onclick = login; $("op-logout").onclick = logout; $("op-pin").addEventListener("keydown", e => { if (e.key === "Enter") login(); }); refreshOpUI(); }
    }
    new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", mount);
    window.addEventListener("festa-op-login", refreshOpUI);
})();
