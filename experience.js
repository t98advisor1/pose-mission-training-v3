/**
 * experience.js - 휴대폰 최적화 풀스크린 포즈 게임 엔진 (최종 수정본)
 * 1) 카메라/모델 비동기 대기 중 종료 시 startBtn 잠금 즉시 해제 및 세대 충돌 방지
 * 2) 사용자 수동 일시정지(userPaused)와 탭 비활성화 플로우 분리
 * 3) 하체 스켈레톤 라인 추가 및 AR 장식(사슴뿔/빨간 코/볼터치) 토글 기능 연동
 * 4) active 진입 시 RAF 유효성 검사 및 보너스 토스트 즉시 초기화
 * Codex 후속 통합31: 22개 몸 관절·7등급 전신 보너스, 텍스트 예고, 연속 2초 최저 등급.
 * Codex 후속 통합33: 점수·저장과 분리한 전체 화면 예비 연습 및 선택 포즈 반복.
 */
(function() {
    // 7개 포즈 메타데이터
    const POSE_INFO = {
        big_v: { emoji: "🙆‍♂️", desc: "두 팔을 머리 위로 펴서 시원하게 V자를 만드세요!" },
        heart: { emoji: "🫶", desc: "두 팔을 둥글게 구부려 머리 위에서 하트를 만드세요!" },
        victory: { emoji: "✌️", desc: "손가락으로 예쁜 브이(Victory)를 카메라에 비춰주세요!" },
        thumb_up: { emoji: "👍", desc: "엄지를 번쩍 들어 최고를 표현하세요!" },
        flower: { emoji: "🌻", desc: "사진처럼 손바닥을 펼쳐 볼 양옆에! 손목은 어깨보다 조금 위로 올려요." },
        hero: { emoji: "🦸‍♂️", desc: "한 손은 하늘 높이 뻗고, 반대 손은 듬직하게 허리에 얹으세요!" },
        dab: { emoji: "👉", desc: "몸을 45도 옆으로 틀고 양팔을 사선으로 쭉! 두 손은 검지를 펴고 엄지를 세운 권총 모양, 한쪽 무릎은 ㄱ자로 들어요!" },
        body_bonus: { emoji: "⭐", desc: "팔·다리를 활짝! 아무 자세나 2초 유지하면 성공! 관절이 많이 보이고 동작이 클수록 점수가 높아요." }
    };

    // 생명주기 및 세대 관리 변수
    let gameGeneration = 0;
    let missionGeneration = 0;
    let phase = "waiting"; // "waiting" | "preview" | "active" | "success" | "paused" | "result"
    let userPaused = false; // 사용자 수동 pause 구분 플래그

    let bonusScore = 0;
    let eventBonusScore = 0;
    let bodyBonusScore = 0;
    let bodyWindowMinScore = 0;
    let bodyLastValidAt = 0;           // 전신 보너스: 마지막으로 조건을 만족한 프레임 시각
    const BODY_GRACE_MS = 400;          // 이 시간 이내의 일시 가림/떨림은 유지 시간을 초기화하지 않음
    let bodySubmitted = false;
    let missionShots = [];   // 기기 메모리에만 보관(선택해 QR로 받을 때만 서버 전송), localStorage 저장 없음
    let gameStartedAt = null;
    let elapsedMs = 0;
    let elapsedInterval = null;
    let currentSession = null;
    let practiceMode = false;
    let practiceUiSnapshot = null;
    let practiceStartCancel = null;
    let previewTimer = null;
    let successTransitionTimer = null;
    let bonusToastTimer = null;
    let isDecorEnabled = true; // 사슴뿔·빨간 공·볼터치 표시 토글 상태 (새 게임에도 유지)

    // 캔버스 크기 및 Letterbox 캐싱
    const overlayCanvas = document.getElementById("pose-overlay");
    const ctx = overlayCanvas ? overlayCanvas.getContext("2d") : null;
    let letterbox = { offsetX: 0, offsetY: 0, drawWidth: 0, drawHeight: 0 };
    let lastStageW = 0;
    let lastStageH = 0;
    let lastVideoW = 0;
    let lastVideoH = 0;
    let lastDpr = 0;

    // DOM 요소 캐시
    const startScreen = document.getElementById("start-screen");
    const gameScreen = document.getElementById("game-screen");
    const resultScreen = document.getElementById("result-screen");
    const visionStage = document.getElementById("vision-stage");

    const nicknameInput = document.getElementById("nickname-input");
    const startBtn = document.getElementById("start-btn");
    const retryBtn = document.getElementById("retry-btn");
    const playerTag = document.getElementById("player-tag");
    const stepBadge = document.getElementById("step-badge");
    const scoreText = document.getElementById("score-text");
    const bonusScoreText = document.getElementById("bonus-score-text");
    const poseTitle = document.getElementById("pose-title");
    const poseDesc = document.getElementById("pose-desc");
    const poseImg = document.getElementById("pose-img");

    const previewOverlay = document.getElementById("preview-overlay");
    const previewCaption = document.getElementById("preview-caption");
    const bonusPreviewText = document.getElementById("bonus-preview-text");
    const statusBanner = document.getElementById("status-banner");
    const bonusToast = document.getElementById("bonus-toast");
    const progressFill = document.getElementById("progress-fill");
    const holdText = document.getElementById("hold-text");

    const pauseResumeBtn = document.getElementById("pause-resume-btn");
    const replayPhotoBtn = document.getElementById("replay-photo-btn");
    const exitGameBtn = document.getElementById("exit-game-btn");
    const decorToggleBtn = document.getElementById("decor-toggle");
    const practiceControls = document.getElementById("practice-controls");
    const practicePoseSelect = document.getElementById("practice-pose-select");

    const gameSyncStatus = document.getElementById("game-sync-status");
    const resultSyncStatus = document.getElementById("result-sync-status");
    const resultUserSummary = document.getElementById("result-user-summary");
    const resultBaseScore = document.getElementById("result-base-score");
    const resultBonusScore = document.getElementById("result-bonus-score");
    const resultTotalScore = document.getElementById("result-total-score");
    const elapsedTime = document.getElementById("elapsed-time");
    const resultElapsedTime = document.getElementById("result-elapsed-time");
    const resultBonusBreakdown = document.getElementById("result-bonus-breakdown");

    function renderElapsedTime() {
        const seconds = Math.floor(elapsedMs / 1000);
        const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        if (elapsedTime) elapsedTime.innerText = `⏱ ${text}`;
        if (resultElapsedTime) resultElapsedTime.innerText = `소요 시간 ${text}`;
    }

    function updateElapsedTime() {
        if (gameStartedAt !== null) elapsedMs = Math.max(elapsedMs, Date.now() - gameStartedAt, 0);
        renderElapsedTime();
    }

    function stopElapsedClock() {
        if (elapsedInterval !== null) clearInterval(elapsedInterval);
        elapsedInterval = null;
        gameStartedAt = null;
    }

    function startElapsedClock() {
        stopElapsedClock();
        elapsedMs = 0;
        gameStartedAt = Date.now();
        renderElapsedTime();
        elapsedInterval = setInterval(updateElapsedTime, 1000);
    }

    function renderScoreNumbers() {
        if (practiceMode) {
            if (scoreText) scoreText.innerText = "저장 안 함";
            return;
        }
        totalScore = Math.max(0, Math.min(700, totalScore));
        bonusScore = eventBonusScore + bodyBonusScore;
        if (scoreText) scoreText.innerText = `${totalScore}점`;
        if (bonusScoreText) bonusScoreText.innerText = `+${bonusScore}`;
        if (resultBaseScore) resultBaseScore.innerText = `${totalScore}점`;
        if (resultBonusScore) resultBonusScore.innerText = `+${bonusScore}점`;
        if (resultTotalScore) resultTotalScore.innerText = `${totalScore + bonusScore}점`;
        if (resultBonusBreakdown) resultBonusBreakdown.innerText = `이벤트 +${eventBonusScore}점 · 전신 +${bodyBonusScore}점`;
    }

    // 2D 각도와 자기 팔다리 길이 대비 벌림 비율. 실제 사람/휴대폰 경계값은 추가 검증 필요.
    const BODY_BONUS_POINTS = Object.freeze(Array.from({length:22}, (_,i) => i+11));
    const FRAME_POINTS = [11,12,23,24,25,26,27,28];
    const EPS = 1e-8;
    const pointValid = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
        Number.isFinite(p.visibility) && p.visibility >= .5 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    const subtract = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
    const magnitude = p => Math.hypot(p.x,p.y);
    const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const distance = (a,b) => magnitude(subtract(a,b));
    const unit = p => {const n=magnitude(p);return n>EPS?{x:p.x/n,y:p.y/n}:null;};
    function elbowOrKneeAngle(a,b,c) {
        const u=subtract(a,b),v=subtract(c,b),m=magnitude(u)*magnitude(v);
        if(m<=EPS)return null;
        return Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/m)))*180/Math.PI;
    }
    function limb(p,a,b,c,center) {
        if(!p[a]||!p[b]||!p[c])return {visible:false,angle:null,sideReach:0,open:false,strong:false};
        const out=unit(subtract(p[a],center));
        const length=distance(p[a],p[b])+distance(p[b],p[c]);
        const angle=elbowOrKneeAngle(p[a],p[b],p[c]);
        if(!out||length<=EPS||angle===null)return {visible:true,angle:null,sideReach:0,open:false,strong:false};
        const reach=subtract(p[c],p[a]);
        return {visible:true,angle,sideReach:Math.max(0,Math.min(1,(reach.x*out.x+reach.y*out.y)/length)),open:false,strong:false};
    }
    // v8 (로컬 수정안): 화면 가장자리 여유, 발목 누락 허용(단 등급 상한), 굽힘·큰 동작 모두 점수화.
    // 모든 거리는 몸통 길이(어깨중점-엉덩이중점)로 정규화해 몸 크기·카메라 거리 영향을 줄임.
    const EDGE_MARGIN = 0.03;
    const inFrame = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.visibility) &&
        p.visibility >= .4 && p.x >= -EDGE_MARGIN && p.x <= 1+EDGE_MARGIN && p.y >= -EDGE_MARGIN && p.y <= 1+EDGE_MARGIN;
    function limbActivity(p,a,b,c,torso,down,isLeg) {
        if(!p[a]||!p[b]||!p[c])return {visible:false,angle:null,activity:0,bend:0,reach:0};
        const angle=elbowOrKneeAngle(p[a],p[b],p[c]);
        if(angle===null)return {visible:true,angle:null,activity:0,bend:0,reach:0};
        const bend=Math.max(0,Math.min(1,(180-angle)/90));              // 많이 구부릴수록 1
        const v=subtract(p[c],p[a]),m=magnitude(v);
        // 몸통 아래 방향 기준으로 팔다리가 벗어난 각도: 서 있는 기본 자세는 0, 팔은 120°, 다리는 35° 벌리면 1
        const off=m>EPS?Math.acos(Math.max(-1,Math.min(1,(v.x*down.x+v.y*down.y)/m)))*180/Math.PI:0;
        const reach=Math.max(0,Math.min(1,off/(isLeg?35:120)));
        return {visible:true,angle,bend,reach,activity:Math.max(bend,reach)};
    }
    function evaluateFullBodyBonus(lm,width,height) {
        const count=Array.isArray(lm)?BODY_BONUS_POINTS.filter(i=>inFrame(lm[i])).length:0;
        const failure=(message,metrics=null)=>({valid:false,score:0,grade:0,count,coverage:count/22,spread:0,quality:0,openParts:0,message,metrics});
        if(!Array.isArray(lm)||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
            return failure('카메라 화면이 준비되면 시작해요.');
        const core=[11,12,23,24,25,26];
        if(!core.every(i=>inFrame(lm[i])))return failure('어깨부터 무릎까지 화면 안에 들어오세요. 조금 더 뒤로 물러나 보세요.');
        const p=[];for(const i of BODY_BONUS_POINTS)if(inFrame(lm[i]))p[i]={x:lm[i].x*width,y:lm[i].y*height};
        const shoulders=midpoint(p[11],p[12]),hips=midpoint(p[23],p[24]);
        const torso=distance(shoulders,hips);
        if(distance(p[11],p[12])<=EPS||distance(p[23],p[24])<=EPS||torso<=EPS)
            return failure('몸의 관절이 다시 보이도록 자세를 잡아주세요.');
        const down=unit(subtract(hips,shoulders));
        const parts=[limbActivity(p,11,13,15,torso,down,false),limbActivity(p,12,14,16,torso,down,false),limbActivity(p,23,25,27,torso,down,true),limbActivity(p,24,26,28,torso,down,true)];
        const metrics={leftArm:parts[0],rightArm:parts[1],leftLeg:parts[2],rightLeg:parts[3]};
        const openParts=parts.filter(x=>x.activity>=.35).length;
        // 어떤 자세든 2초 유지하면 성공. 점수는 보이는 관절 수와 동작 크기(굽힘·뻗음)로 결정.
        const coverage=count/22;
        const spread=parts.reduce((sum,x)=>sum+x.activity,0)/4;   // 가려진 팔다리는 activity 0이라 이득 없음
        const quality=coverage*(0.4+0.6*spread);   // 관절 수가 1차 기준, 동작 크기는 보조 가중치(같은 관절 수에서 더 크게 움직이면 높은 단계)
        let grade=Math.max(1,Math.min(7,Math.ceil(quality*7-1e-9)));
        if(!inFrame(lm[27])||!inFrame(lm[28]))grade=Math.min(grade,4); // 발목이 안 보이면 최대 4단계
        const score=grade*100;
        return {valid:true,score,grade,count,coverage,spread,quality,openParts,message:`${grade}/7단계, 예상 ${score}점이에요. 2초 동안 유지하세요.`,metrics};
    }
    window.evaluateFullBodyBonus = evaluateFullBodyBonus;

    // 화면 전환 제어
    function setAppScreen(targetScreenName) {
        startScreen.classList.remove("active");
        gameScreen.classList.remove("active");
        resultScreen.classList.remove("active");

        if (targetScreenName === "start") {
            startScreen.classList.add("active");
        } else if (targetScreenName === "game") {
            gameScreen.classList.add("active");
        } else if (targetScreenName === "result") {
            resultScreen.classList.add("active");
        }

        if (window.PoseSheet && typeof window.PoseSheet.setScreen === "function") {
            window.PoseSheet.setScreen(targetScreenName);
        }
    }

    // 캔버스 버퍼 리사이즈 및 Letterbox 좌표 계산
    function updateCanvasSizeAndLetterbox() {
        if (!overlayCanvas || !visionStage || !webcam) return;

        const stageRect = visionStage.getBoundingClientRect();
        const stageW = Math.round(stageRect.width);
        const stageH = Math.round(stageRect.height);
        if (stageW === 0 || stageH === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const videoW = webcam.videoWidth || 640;
        const videoH = webcam.videoHeight || 480;

        if (stageW !== lastStageW || stageH !== lastStageH ||
            videoW !== lastVideoW || videoH !== lastVideoH || dpr !== lastDpr) {

            lastStageW = stageW;
            lastStageH = stageH;
            lastVideoW = videoW;
            lastVideoH = videoH;
            lastDpr = dpr;

            overlayCanvas.width = stageW * dpr;
            overlayCanvas.height = stageH * dpr;
            overlayCanvas.style.width = stageW + "px";
            overlayCanvas.style.height = stageH + "px";

            if (ctx) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr, dpr);
            }

            const stageAspect = stageW / stageH;
            const videoAspect = videoW / videoH;

            let drawW, drawH, offX, offY;
            if (stageAspect > videoAspect) {
                drawH = stageH;
                drawW = stageH * videoAspect;
                offX = (stageW - drawW) / 2;
                offY = 0;
            } else {
                drawW = stageW;
                drawH = stageW / videoAspect;
                offX = 0;
                offY = (stageH - drawH) / 2;
            }

            letterbox = { offsetX: offX, offsetY: offY, drawWidth: drawW, drawHeight: drawH };
            let dbg = document.getElementById("cam-size-badge");
            if (!dbg) {
                dbg = document.createElement("div");
                dbg.id = "cam-size-badge";
                dbg.style.cssText = "position:absolute;right:6px;top:126px;z-index:12;font-size:.62rem;color:#e2e8f0;background:rgba(0,0,0,.45);padding:1px 6px;border-radius:8px;pointer-events:none";
                visionStage.appendChild(dbg);
            }
            dbg.textContent = "영상 " + videoW + "x" + videoH + (videoW >= videoH ? " 가로" : " 세로") + " / 화면 " + stageW + "x" + stageH;
        }
    }

    // [시험용 초안, 미배포] 지금 보이는 카메라 영상 + 코 장식 + 관절 표시를 브라우저 안에서 한 장으로 합성(서버 전송 없음)
    function clearMissionShots() { missionShots.forEach(x => { try { URL.revokeObjectURL(x.url); } catch (e) {} }); missionShots = []; const g = document.getElementById("shots-gallery-box"); if (g) g.style.display = "none"; }
    function pushMissionShot(name) {
        try {
            const c = window.captureMissionFrame();
            const idx = missionShots.length;
            missionShots.push({ name, url: "", pending: true });
            c.toBlob(b => { if (b) { missionShots[idx] = { name, url: URL.createObjectURL(b) }; } }, "image/jpeg", 0.9);
        } catch (e) { console.warn("사진 합성 실패", e); }
    }
    window.renderMissionShots = function () {
        const box = document.getElementById("shots-gallery-box"), list = document.getElementById("shots-gallery-list");
        if (!box || !list) return;
        const shots = missionShots.filter(x => x.url);
        list.innerHTML = "";
        if (!shots.length) { box.style.display = "none"; return; }
        box.style.display = "block";
        shots.forEach((x, i) => {
            const d = document.createElement("label");
            d.style.cssText = "display:block;background:#fff;border-radius:10px;padding:4px;text-align:center;font-size:.75rem";
            d.innerHTML = '<img alt="" style="width:100%;border-radius:8px;display:block"><input type="checkbox" data-i="' + i + '"> ' + x.name;
            d.querySelector("img").src = x.url;
            list.appendChild(d);
        });
        window.getPickedShots = () => [...list.querySelectorAll("input:checked")].map(e => shots[+e.dataset.i]);
        const dl = document.getElementById("shots-download-btn");
        dl.onclick = () => {
            const picked = [...list.querySelectorAll("input:checked")].map(e => shots[+e.dataset.i]);
            if (!picked.length) { document.getElementById("shots-msg").textContent = "저장할 사진을 먼저 선택해 주세요."; return; }
            picked.forEach((x, k) => setTimeout(() => { const a = document.createElement("a"); a.href = x.url; a.download = "포즈챌린지-" + x.name + ".jpg"; document.body.appendChild(a); a.click(); a.remove(); }, k * 400));
            document.getElementById("shots-msg").textContent = picked.length + "장 저장을 시작했어요. 실제 기기 갤러리/다운로드 폴더 저장은 직접 확인해 주세요.";
        };
    };
    window.captureMissionFrame = function () {
        const w = Math.round(visionStage.getBoundingClientRect().width), h = Math.round(visionStage.getBoundingClientRect().height);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
        const lb = letterbox;
        g.save(); g.translate(w, 0); g.scale(-1, 1);          // 화면과 같은 거울 모드
        g.drawImage(webcam, lb.offsetX, lb.offsetY, lb.drawWidth, lb.drawHeight);
        g.drawImage(overlayCanvas, 0, 0, w, h);
        g.restore();
        return c;
    };
    window.addEventListener("resize", () => {
        lastStageW = 0;
        updateCanvasSizeAndLetterbox();
    });

    function normToCanvas(pt) {
        return {
            x: letterbox.offsetX + pt.x * letterbox.drawWidth,
            y: letterbox.offsetY + pt.y * letterbox.drawHeight
        };
    }

    function clearOverlayCanvas() {
        if (ctx && overlayCanvas) {
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
    }

    function clearBonusToast() {
        if (bonusToast) {
            bonusToast.classList.remove("pop");
        }
        if (bonusToastTimer) {
            clearTimeout(bonusToastTimer);
            bonusToastTimer = null;
        }
    }

    // AR 장식 렌더링: 딸기 코 🍓 & 파티 꼬깔모자
    function drawFaceDecorations(landmarks) {
      if (!isDecorEnabled || !ctx || !landmarks) return;

      const nose = landmarks[0];
      const leftEye = landmarks[2];
      const rightEye = landmarks[5];
      const leftEar = landmarks[7];
      const rightEar = landmarks[8];

      // 코 유효성 검사
      if (!isValidPoint(nose)) return;

      const hasEyes = isValidPoint(leftEye) && isValidPoint(rightEye);
      const hasEars = isValidPoint(leftEar) && isValidPoint(rightEar);

      // 코 필수 + (눈 쌍 또는 귀 쌍 유효 필수)
      if (!hasEyes && !hasEars) return;

      const noseCanvas = normToCanvas(nose);
      let pA, pB;
      let rawWidth = 0;

      if (hasEyes) {
        const eyeA = normToCanvas(leftEye);
        const eyeB = normToCanvas(rightEye);
        const eyeDist = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y);
        rawWidth = eyeDist * 2.2;
        // 화면 x가 작은 쪽 -> 큰 쪽 순서로 정렬하여 각도 일관성 유지 (좌우 반전 대응)
        if (eyeA.x <= eyeB.x) {
          pA = eyeA;
          pB = eyeB;
        } else {
          pA = eyeB;
          pB = eyeA;
        }
      } else {
        const earA = normToCanvas(leftEar);
        const earB = normToCanvas(rightEar);
        rawWidth = Math.hypot(earB.x - earA.x, earB.y - earA.y);
        if (earA.x <= earB.x) {
          pA = earA;
          pB = earB;
        } else {
          pA = earB;
          pB = earA;
        }
      }

      // 35..220px clamp
      const faceWidth = Math.max(35, Math.min(220, rawWidth));
      const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);

      ctx.save();
      // 코를 원점으로 이동 후 회전
      ctx.translate(noseCanvas.x, noseCanvas.y);
      ctx.rotate(angle);

      // 1. 양 볼터치 (은은한 분홍 그라데이션)
      const blushRadius = faceWidth * 0.22;
      const blushPositions = [
        { x: -faceWidth * 0.3, y: faceWidth * 0.12 },
        { x: faceWidth * 0.3, y: faceWidth * 0.12 }
      ];

      ctx.save();
      blushPositions.forEach(pos => {
        const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, blushRadius);
        grad.addColorStop(0, "rgba(255, 105, 140, 0.45)");
        grad.addColorStop(0.6, "rgba(255, 150, 170, 0.25)");
        grad.addColorStop(1, "rgba(255, 180, 190, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, blushRadius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // 2. 가용 상단 공간에 맞춘 빨간 사슴뿔 머리띠 및 뿔
  // 캔버스 상단 여백 6px 확보
  const topMargin = 6;
  const availableTop = Math.max(0, noseCanvas.y - topMargin);

  // 기본 세로 레이아웃 비율
  const defaultHeadOffset = faceWidth * 0.9;      // 코에서 머리띠 중심까지 높이
  const defaultArchH = faceWidth * 0.15;           // 머리띠 아치 높이
  const defaultAntlerH = faceWidth * 0.76;         // 뿔 끝까지의 높이
  const defaultTotalH = defaultHeadOffset + defaultArchH + defaultAntlerH;

  // 기본 가로 규격 (축소되지 않고 원래 모양 유지)
  const bandRadiusX = faceWidth * 0.55;
  const bandRadiusY = faceWidth * 0.22;
  const antlerSideOffset = faceWidth * 0.38;

  let bandCenterY;
  let antlerScaleY;

  // 상단 공간이 충분할 경우 기본 비율 유지, 부족할 경우 세로만 압축
  if (availableTop >= defaultTotalH) {
    bandCenterY = -defaultHeadOffset;
    antlerScaleY = 1.0;
  } else {
    // 머리띠 위치: 최소 코 위 10px부터 가용 높이의 40% 지점까지 유연하게 배치
    const minBandOffset = Math.max(10, faceWidth * 0.25);
    const targetBandOffset = Math.max(minBandOffset, availableTop * 0.4);
    bandCenterY = -Math.min(defaultHeadOffset, targetBandOffset);

    // 머리띠 위로 뿔이 사용할 수 있는 남은 세로 높이 계산
    const remainForAntler = Math.max(0, availableTop - (Math.abs(bandCenterY) + defaultArchH));
    // 최소 0.15배율 보장하여 형태 왜곡 및 음수/0 크기 방지
    antlerScaleY = Math.max(0.15, Math.min(1.0, remainForAntler / defaultAntlerH));
  }

  // 머리띠 아치 (빨간 둥근선)
  ctx.save();
  ctx.strokeStyle = "#c62828";
  ctx.lineWidth = Math.max(3, faceWidth * 0.05);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(0, bandCenterY, bandRadiusX, bandRadiusY, 0, Math.PI * 0.9, Math.PI * 2.1, false);
  ctx.stroke();

  // 좌우 대칭 사슴뿔 (가로 비율 유지, 세로만 가용 공간에 맞춰 비례 축소)
  const antlerBaseY = bandCenterY - bandRadiusY * 0.5;
  ctx.fillStyle = "#c62828";

  [-1, 1].forEach(side => {
    ctx.save();
    ctx.translate(side * antlerSideOffset, antlerBaseY);
    ctx.scale(side, antlerScaleY); // 좌우 대칭 및 세로 높이 스케일링

    // 주 줄기
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(faceWidth * 0.05, -faceWidth * 0.25, -faceWidth * 0.05, -faceWidth * 0.55, -faceWidth * 0.15, -faceWidth * 0.75);
    ctx.lineTo(-faceWidth * 0.08, -faceWidth * 0.76);
    ctx.bezierCurveTo(faceWidth * 0.02, -faceWidth * 0.55, faceWidth * 0.12, -faceWidth * 0.25, faceWidth * 0.06, 0);
    ctx.closePath();
    ctx.fill();

    // 아래쪽 가지 (갈래 1)
    ctx.beginPath();
    ctx.moveTo(0, -faceWidth * 0.25);
    ctx.quadraticCurveTo(-faceWidth * 0.22, -faceWidth * 0.38, -faceWidth * 0.28, -faceWidth * 0.42);
    ctx.quadraticCurveTo(-faceWidth * 0.22, -faceWidth * 0.32, -faceWidth * 0.02, -faceWidth * 0.35);
    ctx.closePath();
    ctx.fill();

    // 위쪽 가지 (갈래 2)
    ctx.beginPath();
    ctx.moveTo(-faceWidth * 0.03, -faceWidth * 0.45);
    ctx.quadraticCurveTo(-faceWidth * 0.32, -faceWidth * 0.56, -faceWidth * 0.35, -faceWidth * 0.62);
    ctx.quadraticCurveTo(-faceWidth * 0.24, -faceWidth * 0.52, -faceWidth * 0.07, -faceWidth * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  });
  ctx.restore();

  // 3. 코 위의 입체 빨간 공 (반경 faceWidth * 0.15)
      const noseRadius = faceWidth * 0.15;
      const lightOffsetX = -noseRadius * 0.35;
      const lightOffsetY = -noseRadius * 0.35;

      ctx.save();
      // 입체 음영 radial gradient
      const noseGrad = ctx.createRadialGradient(
        lightOffsetX,
        lightOffsetY,
        noseRadius * 0.1,
        0,
        0,
        noseRadius
      );
      noseGrad.addColorStop(0, "#ff6b6b");
      noseGrad.addColorStop(0.4, "#e50914");
      noseGrad.addColorStop(0.85, "#b30000");
      noseGrad.addColorStop(1, "#660000");

      ctx.fillStyle = noseGrad;
      ctx.beginPath();
      ctx.arc(0, 0, noseRadius, 0, Math.PI * 2);
      ctx.fill();

      // 작은 화이트 하이라이트
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(lightOffsetX, lightOffsetY, noseRadius * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }

    // 관절 스켈레톤 라인 (상체 및 하체 연결선 추가)
    function drawSkeleton(landmarks, isMatched) {
        if (!ctx || !landmarks) return;

        const CONNECTIONS = [
            [11, 12], [11, 13], [13, 15],
            [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24],
            [23, 25], [25, 27], [24, 26], [26, 28],
            [15, 17], [15, 19], [15, 21], [17, 19],
            [16, 18], [16, 20], [16, 22], [18, 20],
            [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]
        ];

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const mainColor = isMatched ? "#16a34a" : "#0ea5e9";
        const jointColor = isMatched ? "#bbf7d0" : "#fde047";

        // 관절 가시성 보완: 어두운 바깥선 + 흰 테두리 + 밝은 연결선 (표시만 변경, 인식·점수 판정은 그대로)
        const drawLines = (width, color) => {
            ctx.lineWidth = width;
            ctx.strokeStyle = color;
            CONNECTIONS.forEach(([i, j]) => {
                const p1 = landmarks[i];
                const p2 = landmarks[j];
                if (pointValid(p1) && pointValid(p2)) {
                    const c1 = normToCanvas(p1);
                    const c2 = normToCanvas(p2);
                    ctx.beginPath();
                    ctx.moveTo(c1.x, c1.y);
                    ctx.lineTo(c2.x, c2.y);
                    ctx.stroke();
                }
            });
        };
        drawLines(11, "rgba(15,23,42,0.75)");
        drawLines(8, "#ffffff");
        drawLines(5, mainColor);

        BODY_BONUS_POINTS.forEach(idx => {
            const pt = landmarks[idx];
            if (pointValid(pt)) {
                const c = normToCanvas(pt);
                ctx.beginPath();
                ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(15,23,42,0.8)";
                ctx.fill();
                ctx.beginPath();
                ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
                ctx.fillStyle = jointColor;
                ctx.fill();
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = "#ffffff";
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    window.resetHoldTimer = function(reasonMsg = null) {
        accumulatedHoldMs = 0;
        lastFrameTimestamp = null;
        bodyWindowMinScore = 0;
        if (progressFill) progressFill.style.width = "0%";
        if (holdText) holdText.innerText = "0.0s";
        if (reasonMsg && phase === "active" && !clearedPoses[currentPoseIndex]) {
            if (statusBanner) {
                statusBanner.className = "vision-hud-banner";
                statusBanner.innerText = `[인식중] ${reasonMsg}`;
            }
        }
    };

    function getNextIncompletePoseIndex() {
        if (practiceMode) return currentPoseIndex;
        for (let i = 0; i < poses.length; i++) {
            if (!clearedPoses[i]) return i;
        }
        return -1;
    }

    function closePosePreview() {
        if (previewOverlay) previewOverlay.classList.remove("active", "bonus-text-preview");
        if (bonusPreviewText) bonusPreviewText.style.display = "none";
        if (poseImg) {
            poseImg.onload = null;
            poseImg.onerror = null;
        }
        const hintImg = document.getElementById("pose-hint-img");
        if (hintImg) hintImg.onerror = null;
    }

    window.handleAppDeactivation = function() {
        missionGeneration++;
        phase = "paused";

        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        if (successTransitionTimer) {
            clearTimeout(successTransitionTimer);
            successTransitionTimer = null;
        }
        clearBonusToast();

        closePosePreview();
        clearOverlayCanvas();

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        window.resetHoldTimer("화면을 벗어나 일시정지되었습니다.");
        // 연습도 숨김 즉시 장치 점유와 진행 중 권한/모델 대기를 취소합니다.
        if (practiceMode) window.stopCamera();
    };

    const nativeStopCamera = window.stopCamera;
    window.stopCamera = function() {
        if (practiceStartCancel) {
            practiceStartCancel();
            practiceStartCancel = null;
        }
        missionGeneration++;
        phase = "paused";

        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        if (successTransitionTimer) {
            clearTimeout(successTransitionTimer);
            successTransitionTimer = null;
        }
        clearBonusToast();

        closePosePreview();
        clearOverlayCanvas();

        if (typeof nativeStopCamera === "function") {
            nativeStopCamera();
        }
    };

    // 2초 사진 예고 및 active 전환
    function triggerPosePreview(poseIdx) {
        const thisGameGen = gameGeneration;
        const thisMissionGen = ++missionGeneration;

        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }

        phase = "preview";
        window.resetHoldTimer();
        clearOverlayCanvas();

        const currentPose = poses[poseIdx];
        const isBodyBonus = currentPose.type === "bonus";
        const previewBadge = document.getElementById("preview-badge");
        if (previewBadge) previewBadge.innerText = isBodyBonus ? "전신 보너스 안내 (2초 후 시작)" : "포즈 예시 (2초 후 시작)";
        const poseMeta = (typeof POSE_INFO !== "undefined" && POSE_INFO[currentPose.id]) || { emoji: "✨", desc: "" };

        if (stepBadge) stepBadge.innerText = practiceMode ? "연습" : isBodyBonus ? "BONUS" : `${poseIdx + 1} / 7`;
        if (poseTitle) poseTitle.innerText = `${currentPose.name} ${poseMeta.emoji}`;
        if (poseDesc) poseDesc.innerText = poseMeta.desc;
        if (replayPhotoBtn) replayPhotoBtn.innerText = isBodyBonus ? "안내 다시보기" : "사진 다시보기";
        if (previewOverlay) previewOverlay.classList.toggle("bonus-text-preview", isBodyBonus);
        if (bonusPreviewText) bonusPreviewText.style.display = isBodyBonus ? "flex" : "none";
        if (statusBanner) {
            statusBanner.className = "vision-hud-banner";
            statusBanner.innerText = isBodyBonus ? "전신 보너스 안내를 확인하세요!" : "포즈 사진을 확인하세요!";
        }

        if (previewCaption) previewCaption.innerText = `다음 포즈: ${currentPose.name} ${poseMeta.emoji}`;
        if (previewOverlay) previewOverlay.classList.add("active");

        // 힌트 SVG 요소 및 상태 초기화
        const hintImg = document.getElementById("pose-hint-img");
        const hintFallback = document.getElementById("pose-hint-fallback");
        if (hintImg && !isBodyBonus) {
            hintImg.style.display = "block";
            hintImg.alt = `${currentPose.name} 관절 연결선 힌트`;
            hintImg.onerror = () => {
                hintImg.style.display = "none";
                if (hintFallback) hintFallback.style.display = "flex";
            };
            if (hintFallback) hintFallback.style.display = "none";

            // SVG 로딩 지연은 메인 타이머를 막지 않음
            hintImg.src = `hints-${currentPose.id}.svg`;
        }

        let isHandled = false;
        const onImageReady = () => {
            if (isHandled) return;
            isHandled = true;

            if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration || document.hidden) {
                return;
            }

            // 사진 로드 완료 후 2초 대기
            previewTimer = setTimeout(() => {
                if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration ||
                    document.hidden || !localStream || !webcam || webcam.paused) {
                    return;
                }
                closePosePreview();
                phase = "active";
                window.resetHoldTimer();
                lastFrameTimestamp = null;
                if (statusBanner) {
                    statusBanner.className = "vision-hud-banner";
                    statusBanner.innerText = `[인식중] 2초간 ${currentPose.name} 자세를 유지하세요!`;
                }

                if (!animationFrameId) {
                    animationFrameId = requestAnimationFrame(window.predictWebcam);
                }
            }, 2000);
        };

        poseImg.onload = null;
        poseImg.onerror = null;
        if (isBodyBonus) {
            poseImg.removeAttribute("src");
            if (hintImg) {
                hintImg.onerror = null;
                hintImg.removeAttribute("src");
                hintImg.style.display = "none";
            }
            if (hintFallback) hintFallback.style.display = "none";
            onImageReady();
            return;
        }
        poseImg.onload = onImageReady;
        poseImg.onerror = () => {
            console.warn("포즈 이미지 로드 실패:", currentPose.src);
            if (statusBanner) {
                statusBanner.className = "vision-hud-banner";
                statusBanner.innerText = "자세 힌트를 확인하세요!";
            }
            onImageReady();
        };

        poseImg.src = currentPose.src;

        if (poseImg.complete && poseImg.naturalWidth > 0) {
            onImageReady();
        }
    }

    window.renderPoseView = function(index) {
        currentPoseIndex = index;
        triggerPosePreview(currentPoseIndex);
    };

    function showBonusToast(bonusVal) {
        if (!bonusToast) return;
        clearBonusToast();
        bonusToast.innerText = `✨ 깜짝 보너스 +${bonusVal}점! ✨`;
        bonusToast.classList.add("pop");
        bonusToastTimer = setTimeout(() => {
            bonusToast.classList.remove("pop");
            bonusToastTimer = null;
        }, 800);
    }

    // 실시간 비전 추론 루프
    window.predictWebcam = async function() {
        animationFrameId = null;

        if (document.hidden || !localStream || !webcam || webcam.paused || webcam.ended || !gameScreen.classList.contains("active")) {
            clearOverlayCanvas();
            return;
        }

        if (phase === "paused") {
            clearOverlayCanvas();
            return;
        }

        const now = performance.now();

        if (lastFrameTimestamp !== null) {
            const gap = now - lastFrameTimestamp;
            if (gap > MAX_DELTA_TOLERANCE_MS) {
                window.resetHoldTimer("프레임 지연으로 유지가 초기화되었습니다.");
            }
        }

        if (webcam.currentTime !== lastVideoTime && poseLandmarker) {
            lastVideoTime = webcam.currentTime;
            updateCanvasSizeAndLetterbox();
            clearOverlayCanvas();

            const currentMission = poses[currentPoseIndex];
            let isMatched = false;
            let bodyEvaluation = null;
            let poseResults = null;
            let gestureResults = null;

            try {
                poseResults = poseLandmarker.detectForVideo(webcam, now);
                const hasPose = poseResults.landmarks && poseResults.landmarks.length > 0;
                const userLandmarks = hasPose ? poseResults.landmarks[0] : null;

                if (!userLandmarks) {
                    clearOverlayCanvas();
                    window.resetHoldTimer("사람이 감지되지 않습니다.");
                } else {
                    drawFaceDecorations(userLandmarks);

                    if (currentMission.type === "gesture" || currentMission.type === "hybrid") {
                        if (gestureRecognizer) {
                            gestureResults = gestureRecognizer.recognizeForVideo(webcam, now);
                        }
                    }

                    if (phase === "active") {
                        if (currentMission.type === "pose") {
                            isMatched = checkPoseMatches(currentMission.id, userLandmarks, null);
                        } else if (currentMission.type === "gesture") {
                            isMatched = checkGestureMatches(currentMission.gesture, gestureResults);
                        } else if (currentMission.type === "hybrid") {
                            isMatched = checkPoseMatches(currentMission.id, userLandmarks, gestureResults);
                        } else if (currentMission.type === "bonus") {
                            bodyEvaluation = evaluateFullBodyBonus(userLandmarks, webcam.videoWidth, webcam.videoHeight);
                            isMatched = bodyEvaluation.valid;
                        }

                        drawSkeleton(userLandmarks, isMatched);

                        if (isMatched && bodyEvaluation) bodyLastValidAt = now;
                        if (!isMatched && bodyEvaluation && accumulatedHoldMs > 0 && now - bodyLastValidAt <= BODY_GRACE_MS) {
                            lastFrameTimestamp = now; // 짧은 인식 끊김: 유지 시간 정지(누적 안 함), 초기화 안 함
                        } else if (isMatched) {
                            if (bodyEvaluation) {
                                bodyWindowMinScore = bodyWindowMinScore === 0 ? bodyEvaluation.score : Math.min(bodyWindowMinScore, bodyEvaluation.score);
                            }
                            if (lastFrameTimestamp !== null) {
                                const delta = now - lastFrameTimestamp;
                                if (delta > 0 && delta <= MAX_DELTA_TOLERANCE_MS) {
                                    accumulatedHoldMs += delta;
                                }
                            }
                            lastFrameTimestamp = now;

                            const ratio = Math.min(accumulatedHoldMs / REQUIRED_HOLD_MS, 1.0);
                            if (progressFill) progressFill.style.width = `${(ratio * 100).toFixed(0)}%`;
                            if (holdText) holdText.innerText = `${(accumulatedHoldMs / 1000).toFixed(1)}s`;

                            if (statusBanner) {
                                statusBanner.className = "vision-hud-banner success";
                                statusBanner.innerText = bodyEvaluation
                                    ? `[자세맞음] ${bodyWindowMinScore/100}/7단계 · 관절 ${bodyEvaluation.count}/22 · 예상 +${bodyWindowMinScore}점 · ${(accumulatedHoldMs / 1000).toFixed(1)}s 유지`
                                    : `[자세맞음] 완벽해요! 유지하세요! (${(accumulatedHoldMs / 1000).toFixed(1)}s)`;
                            }

                            if (accumulatedHoldMs >= REQUIRED_HOLD_MS) {
                                phase = "success";
                                accumulatedHoldMs = 0;
                                lastFrameTimestamp = null;

                                if (practiceMode) {
                                    if (statusBanner) {
                                        statusBanner.className = "vision-hud-banner success";
                                        statusBanner.innerText = `🎉 '${currentMission.name}' 연습 성공! 기록하지 않습니다.`;
                                    }
                                    const thisGameGen = gameGeneration;
                                    const thisMissionGen = missionGeneration;
                                    const selectedIndex = currentPoseIndex;
                                    successTransitionTimer = setTimeout(() => {
                                        successTransitionTimer = null;
                                        if (!practiceMode || thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration || document.hidden) return;
                                        window.renderPoseView(selectedIndex);
                                    }, 800);
                                } else if (!clearedPoses[currentPoseIndex]) {
                                    clearedPoses[currentPoseIndex] = true;
                                    pushMissionShot(currentMission.name);
                                    const isBodyBonus = currentMission.type === "bonus";
                                    const bodyTier = bodyWindowMinScore;
                                    if (!isBodyBonus) totalScore = Math.min(700, totalScore + 100);

                                    let bonusVal = 0;
                                    if ((!isBodyBonus || !bodySubmitted) && window.PoseSheet && typeof window.PoseSheet.complete === "function") {
                                        if (isBodyBonus) bodySubmitted = true;
                                        const res = window.PoseSheet.complete(isBodyBonus ? `전신 보너스 ${bodyTier}` : (currentMission.mission || currentMission.name));
                                        if (res && Number.isFinite(res.bonus) && res.bonus >= 0) {
                                            bonusVal = res.bonus;
                                        }
                                    }
                                    if (isBodyBonus) {
                                        bodyBonusScore += [100, 200, 300, 400, 500, 600, 700].includes(bonusVal) ? bonusVal : 0;
                                    } else {
                                        eventBonusScore += [10, 20, 30].includes(bonusVal) ? bonusVal : 0;
                                    }
                                    renderScoreNumbers();
                                    if (!isBodyBonus && bonusVal > 0) {
                                        showBonusToast(bonusVal);
                                    }

                                    updateSyncStatusDisplay();

                                    if (statusBanner) {
                                        statusBanner.className = "vision-hud-banner success";
                                        statusBanner.innerText = isBodyBonus
                                            ? `🎉 전신 보너스 성공! (예상 +${bodyBonusScore}점)`
                                            : `🎉 '${currentMission.name}' 성공! (+100점)`;
                                    }

                                    const thisGameGen = gameGeneration;
                                    const thisMissionGen = missionGeneration;

                                    successTransitionTimer = setTimeout(() => {
                                        if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration) return;

                                        const nextIdx = getNextIncompletePoseIndex();
                                        if (nextIdx !== -1) {
                                            window.renderPoseView(nextIdx);
                                        } else {
                                            phase = "result";
                                            window.stopCamera();
                                            showResultScreen();
                                        }
                                    }, 800);
                                }
                            }
                        } else {
                            window.resetHoldTimer(bodyEvaluation
                                ? `0/7단계 · 관절 ${bodyEvaluation.count}/22 · 예상 +0점 · ${bodyEvaluation.message}`
                                : "자세를 맞추고 2초 동안 유지해 주세요!");
                        }
                    } else {
                        drawSkeleton(userLandmarks, false);
                    }
                }
            } catch (inferErr) {
                console.error("추론 처리 오류:", inferErr);
                clearOverlayCanvas();
                window.resetHoldTimer("인식 오류로 유지가 초기화되었습니다.");
            }
        }

        if (!document.hidden && localStream && webcam && !webcam.paused && gameScreen.classList.contains("active") && phase !== "paused") {
            if (!animationFrameId) {
                animationFrameId = requestAnimationFrame(window.predictWebcam);
            }
        }
    };

    function showResultScreen() {
        updateElapsedTime();
        stopElapsedClock();
        setAppScreen("result");
        if (window.renderMissionShots) window.renderMissionShots();
        const nickname = (currentSession && currentSession.nickname) ? currentSession.nickname : "선생님";
        if (resultUserSummary) resultUserSummary.innerText = `${nickname} 선생님, 7개 미션과 전신 보너스를 완료했습니다!`;
        renderScoreNumbers();
        updateSyncStatusDisplay();
    }

    // ① 점수 수치 갱신만 처리하는 updateSyncStatusDisplay 함수
    function updateSyncStatusDisplay() {
        if (practiceMode) return;
        if (window.PoseSheet && typeof window.PoseSheet.getState === "function") {
            const state = window.PoseSheet.getState();
            if (state) {
                const pendingCount = state.pending || 0;

                if (pendingCount === 0 && state.challengeId && currentSession && state.challengeId === currentSession.challengeId) {
                    if (Number.isFinite(state.baseScore)) totalScore = state.baseScore;
                    if (Number.isFinite(state.bodyBonusScore)) bodyBonusScore = Math.max(0, Math.min(700, state.bodyBonusScore));
                    if (Number.isFinite(state.eventBonusScore)) eventBonusScore = Math.max(0, Math.min(210, state.eventBonusScore));
                    else if (Number.isFinite(state.bonusScore)) eventBonusScore = Math.max(0, Math.min(210, state.bonusScore - bodyBonusScore));
                    renderScoreNumbers();
                }
            }
        }
    }

    window.addEventListener("pose-sheet-saved", (evt) => {
        if (!practiceMode && evt.detail && currentSession && evt.detail.challengeId === currentSession.challengeId) {
            updateSyncStatusDisplay();
        }
    });

    // UI 상태만 바꾸며 실제 저장 큐와 기존 도전에는 손대지 않습니다.
    function setPracticeMode(enabled) {
        if (enabled && !practiceMode) {
            practiceUiSnapshot = {
                player: playerTag && playerTag.innerText,
                badge: stepBadge && stepBadge.innerText,
                exit: exitGameBtn && exitGameBtn.innerText,
                display: [bonusScoreText, gameSyncStatus, document.getElementById("game-save-status")]
                    .filter(Boolean).map(element => ({element, display: element.style.display}))
            };
        }
        practiceMode = enabled;
        gameScreen.classList.toggle("practice-mode", enabled);
        if (practiceControls) practiceControls.hidden = !enabled;
        if (enabled) {
            if (playerTag) playerTag.innerText = "예비 연습 · 기록 안 함";
            if (stepBadge) stepBadge.innerText = "연습";
            if (scoreText) scoreText.innerText = "저장 안 함";
            if (exitGameBtn) exitGameBtn.innerText = "연습 마치기";
            for (const element of [bonusScoreText, gameSyncStatus, document.getElementById("game-save-status")]) {
                if (element) element.style.display = "none";
            }
        } else if (practiceUiSnapshot) {
            if (playerTag) playerTag.innerText = practiceUiSnapshot.player;
            if (stepBadge) stepBadge.innerText = practiceUiSnapshot.badge;
            if (exitGameBtn) exitGameBtn.innerText = practiceUiSnapshot.exit;
            for (const item of practiceUiSnapshot.display) item.element.style.display = item.display || "";
            practiceUiSnapshot = null;
            renderScoreNumbers();
        }
    }

    function practiceIndex(poseId) {
        const index = poses.findIndex(pose => pose.id === poseId);
        const fallback = poses.findIndex(pose => pose.id === "big_v");
        return index >= 0 ? index : Math.max(0, fallback);
    }

    async function startPractice(poseId = "big_v") {
        if (document.hidden) return false;
        const capturedGameGen = ++gameGeneration;
        window.stopCamera();
        currentSession = null;
        userPaused = false;
        clearMissionShots();
        clearedPoses = new Array(poses.length).fill(false);
        totalScore = bonusScore = eventBonusScore = bodyBonusScore = 0;
        bodySubmitted = false;
        currentPoseIndex = practiceIndex(poseId);
        setPracticeMode(true);
        if (practicePoseSelect) practicePoseSelect.value = poses[currentPoseIndex].id;
        startBtn.disabled = false;
        startElapsedClock();
        setAppScreen("game");
        phase = "waiting";
        const capturedMissionGen = missionGeneration;
        if (pauseResumeBtn) pauseResumeBtn.innerText = "카메라 켜는 중...";
        let cancelThisStart;
        const cancelled = new Promise(resolve => { cancelThisStart = resolve; });
        practiceStartCancel = cancelThisStart;
        try {
            if (typeof window.startCamera === "function") await Promise.race([window.startCamera(), cancelled]);
        } catch (error) {
            if (capturedGameGen !== gameGeneration || capturedMissionGen !== missionGeneration) return false;
            window.stopCamera();
            if (statusBanner) statusBanner.innerText = "연습 카메라를 시작할 수 없습니다. 권한과 장치를 확인해 주세요.";
            if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 계속하기";
            return false;
        } finally {
            if (practiceStartCancel === cancelThisStart) practiceStartCancel = null;
        }
        if (!practiceMode || capturedGameGen !== gameGeneration || capturedMissionGen !== missionGeneration || document.hidden) return false;
        if (!gameScreen.classList.contains("active") || !localStream || !webcam || webcam.paused) {
            phase = "paused";
            if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 계속하기";
            return false;
        }
        if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";
        window.renderPoseView(currentPoseIndex);
        return true;
    }

    function stopPractice() {
        if (!practiceMode) return false;
        const wasPractice = practiceMode;
        gameGeneration++;
        startBtn.disabled = false;
        window.stopCamera();
        stopElapsedClock();
        currentSession = null;
        userPaused = false;
        setPracticeMode(false);
        setAppScreen("start");
        return wasPractice;
    }

    window.PosePractice = Object.freeze({start: startPractice, stop: stopPractice});
    if (practicePoseSelect) practicePoseSelect.addEventListener("change", () => {
        if (!practiceMode || !gameScreen.classList.contains("active")) return;
        const selectedIndex = practiceIndex(practicePoseSelect.value);
        if (successTransitionTimer) clearTimeout(successTransitionTimer);
        successTransitionTimer = null;
        if (userPaused || document.hidden) {
            missionGeneration++;
            currentPoseIndex = selectedIndex;
            practicePoseSelect.value = poses[selectedIndex].id;
            window.resetHoldTimer();
            closePosePreview();
            phase = "paused";
            if (poseTitle) poseTitle.innerText = `${poses[selectedIndex].name} ${POSE_INFO[poses[selectedIndex].id].emoji}`;
            if (poseDesc) poseDesc.innerText = POSE_INFO[poses[selectedIndex].id].desc;
            if (statusBanner) statusBanner.innerText = "연습 포즈를 선택했습니다. 계속하기를 누르면 시작합니다.";
            return;
        }
        // 준비 중/정지 중 선택은 카메라 세대도 취소하여 늦은 이전 응답을 배제합니다.
        if (!localStream || !webcam || webcam.paused || phase === "waiting" || phase === "paused") {
            void startPractice(poses[selectedIndex].id);
        } else {
            practicePoseSelect.value = poses[selectedIndex].id;
            window.renderPoseView(selectedIndex);
        }
    });

    // 시작 버튼 핸들러
    startBtn.addEventListener("click", async () => {
        if (startBtn.disabled) return;
        startBtn.disabled = true;

        const capturedGameGen = ++gameGeneration;
        window.stopCamera();

        const rawNickname = nicknameInput.value.trim();

        if (!window.PoseSheet || typeof window.PoseSheet.begin !== "function") {
            alert("점수 연동 모듈(PoseSheet)이 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.");
            startBtn.disabled = false;
            return;
        }

        try {
            currentSession = window.PoseSheet.begin(rawNickname);
        } catch (validationErr) {
            alert(validationErr.message);
            nicknameInput.focus();
            startBtn.disabled = false;
            return;
        }

        setPracticeMode(false);

        userPaused = false;
        clearMissionShots();
        clearedPoses = new Array(poses.length).fill(false);
        totalScore = 0;
        bonusScore = 0;
        eventBonusScore = 0;
        bodyBonusScore = 0;
        bodySubmitted = false;
        renderScoreNumbers();
        startElapsedClock();
        if (playerTag) playerTag.innerText = `도전자: ${currentSession.nickname}`;

        setAppScreen("game");
        phase = "waiting";
        const capturedMissionGen = missionGeneration;
        if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";
        updateSyncStatusDisplay();

        if (typeof window.startCamera === "function") {
            await window.startCamera();
        }

        // 비동기 대기 후 세대 검증: 이전 세대 요청은 UI를 변경하지 않고 조기 종료
        if (capturedGameGen !== gameGeneration || capturedMissionGen !== missionGeneration || document.hidden) {
            return;
        }

        // 현재 세대인데 카메라가 정상 기동되지 않은 경우 잠금 해제 및 안내
        if (!gameScreen.classList.contains("active") || document.hidden || !localStream || !webcam || webcam.paused) {
            phase = "paused";
            startBtn.disabled = false;
            if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 게임 시작";
            return;
        }

        startBtn.disabled = false;
        window.renderPoseView(0);
    });

    // 재도전 버튼
    retryBtn.addEventListener("click", () => {
        gameGeneration++;
        startBtn.disabled = false;
        window.stopCamera();
        stopElapsedClock();
        setPracticeMode(false);
        setAppScreen("start");
    });

    // 일시정지 / 재개 버튼
    // ② pauseResumeBtn 클릭 이벤트 리스너 등록
    pauseResumeBtn.addEventListener("click", async () => {
        if (phase === "paused") {
            userPaused = false;
            phase = "waiting";
            if (pauseResumeBtn) pauseResumeBtn.innerText = "카메라 켜는 중...";

            const thisGameGen = gameGeneration;
            const thisMissionGen = ++missionGeneration;

            if (!localStream && typeof window.startCamera === "function") {
                await window.startCamera();
            }

            // 세대 변경 시 이전 비동기 작업은 UI를 전혀 건드리지 않고 즉시 종료
            if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration) {
                return;
            }

            // 탭이 숨겨진 상태면 UI 수정 없이 종료
            if (document.hidden) {
                return;
            }

            // 현재 세대인데 카메라가 준비되지 않았거나 재생 중이 아닐 때만 계속하기 안내
            if (!gameScreen.classList.contains("active") || !localStream || !webcam || webcam.paused) {
                phase = "paused";
                if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 계속하기";
                return;
            }

            if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";
            const nextIdx = getNextIncompletePoseIndex();
            if (nextIdx !== -1) {
                window.renderPoseView(nextIdx);
            } else {
                phase = "result";
                window.stopCamera();
                showResultScreen();
            }
        } else {
            // active, preview, waiting(카메라 준비 중) 상태에서 클릭 시 즉시 정지 및 취소
            userPaused = true;
            window.stopCamera();
            phase = "paused";
            if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 계속하기";
            window.resetHoldTimer("게임이 일시정지되었습니다.");
            if (statusBanner) statusBanner.innerText = "일시정지 상태입니다.";
        }
    });

    // 사진 다시보기 (active 상태에서만 허용)
    replayPhotoBtn.addEventListener("click", () => {
        if (phase === "active") {
            triggerPosePreview(currentPoseIndex);
        }
    });

    // 게임 종료 버튼
    exitGameBtn.addEventListener("click", () => {
        if (practiceMode) {
            stopPractice();
            return;
        }
        if (confirm("정말 게임을 종료하고 시작 화면으로 돌아갈까요?")) {
            gameGeneration++;
            startBtn.disabled = false;
            window.stopCamera();
            stopElapsedClock();
            setAppScreen("start");
        }
    });

    // 딸기/모자 장식 토글 버튼 핸들러
    // ③ decorToggleBtn 클릭 이벤트 리스너 등록
    if (decorToggleBtn) {
        decorToggleBtn.addEventListener("click", () => {
            isDecorEnabled = !isDecorEnabled;
            decorToggleBtn.setAttribute("aria-pressed", String(isDecorEnabled));
            decorToggleBtn.innerText = isDecorEnabled ? "🎨 장식 ON" : "🎨 장식 OFF";
            if (!isDecorEnabled) {
                clearOverlayCanvas();
            }
        });
    }

    // 탭 복귀 시 안전 재개 (사용자 수동 pause 상태 제외)
    document.addEventListener("visibilitychange", async () => {
        if (!document.hidden && gameScreen.classList.contains("active") && (currentSession || practiceMode)) {
            updateElapsedTime();
            if (userPaused) {
                return; // 사용자가 직접 멈춘 경우 자동으로 카메라를 켜지 않음
            }

            const thisGameGen = gameGeneration;
            const thisMissionGen = missionGeneration;

            if (!localStream && typeof window.startCamera === "function") {
                phase = "waiting";
                await window.startCamera();
            }

            if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration || userPaused || !gameScreen.classList.contains("active") ||
                document.hidden || !localStream || !webcam || webcam.paused) {
                return;
            }

            if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";

            const nextIdx = getNextIncompletePoseIndex();
            if (nextIdx !== -1) {
                window.renderPoseView(nextIdx);
            } else {
                phase = "result";
                window.stopCamera();
                showResultScreen();
            }
        }
    });

    setAppScreen("start");
})();
