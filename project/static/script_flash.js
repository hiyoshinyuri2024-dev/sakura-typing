// ======================================================
// 科名ラベル
// ======================================================
const DEPT_LABELS = {
    trauma: "外傷",
    infection: "感染症",
    endocrine: "内分泌",
    allergy: "アレルギー",
    urology: "泌尿器",
    obgyn: "産婦人科",
    pediatrics: "小児科",
    psychiatry: "精神科",
    orthopedics: "整形外科",
    dermatology: "皮膚科",
    ent: "耳鼻科",
    ophthalmology: "眼科",
    emergency: "救急",
    geriatrics: "高齢者医療",
    toxicology: "中毒",
    burn: "熱傷"
};

const SPEED_LEVELS = [
    9000,
    6000,
    5125
];

const FEEDBACK_MS = 380;

// ======================================================
// 状態
// ======================================================
let flashWords = [];
let currentIndex = 0;
let currentQuestion = null;

let correctCount = 0;
let mistakes = [];

let consecutiveCorrect = 0;
let consecutiveMiss = 0;

let speedLevelIndex = 0;
let fallDurationMs = SPEED_LEVELS[0];

let phase = "idle"; // idle | playing | grading
let questionFinished = false;

let fallRafId = null;
let fallEl = null;
let fallStartTime = 0;

let petalTimer = null;

let audioCtx = null;

// ======================================================
// Utility
// ======================================================
function normalizeAnswer(s) {
    return String(s ?? "")
        .trim()
        .normalize("NFKC")
        .toLowerCase();
}

function parseQuestions(list) {
    if (!Array.isArray(list)) return [];

    const out = [];

    for (const q of list) {
        if (!q) continue;

        const kanji = String(q.kanji ?? "").trim();
        const abbr = String(q.abbr ?? "").trim();

        if (!kanji) continue;

        out.push({
            kanji,
            abbr: abbr || kanji
        });
    }

    return out;
}

function ensureQuestionArea() {
    let el = document.getElementById("question_area");

    if (!el) {
        el = document.createElement("div");
        el.id = "question_area";

        const gameLayer = document.getElementById("game-layer");

        if (gameLayer) {
            gameLayer.prepend(el);
        } else {
            document.body.prepend(el);
        }
    }

    return el;
}

// ======================================================
// Audio
// ======================================================
function getAudioCtx() {
    if (audioCtx) return audioCtx;

    const Ctx = window.AudioContext || window.webkitAudioContext;

    if (!Ctx) return null;

    audioCtx = new Ctx();

    return audioCtx;
}

function primeAudio() {
    const ctx = getAudioCtx();

    if (!ctx) return;

    ctx.resume().catch(() => {});
}

function playCorrectSound() {
    try {
        const ctx = getAudioCtx();

        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = 880;

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
            0.001,
            ctx.currentTime + 0.15
        );

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.15);

    } catch (e) {
        console.error(e);
    }
}

function playMissSound() {
    try {
        const audio = new Audio("/static/error.mp3");

        audio.currentTime = 0;

        audio.play().catch(() => {});

    } catch (e) {
        console.error(e);
    }
}

function playKoto() {
    try {
        console.log("koto called");

        const audio = new Audio("/static/koto.mp3");

        // ★ 初期音量を下げる（重要）
        audio.volume = 0.25;  // ← ここで調整（0.2〜0.3推奨）

        audio.muted = false;

        audio.play().catch(e => {
            console.error("AUDIO ERROR", e);
        });

        // ===== フェードアウト（10秒） =====
        const fadeDuration = 10000; // 10秒
        const step = 100;           // 更新間隔
        const fadeAmount = audio.volume / (fadeDuration / step);

        const fade = setInterval(() => {
            if (audio.volume > fadeAmount) {
                audio.volume -= fadeAmount;
            } else {
                audio.volume = 0;
                clearInterval(fade);
                audio.pause();
            }
        }, step);

    } catch (e) {
        console.error("KOTO ERROR", e);
    }
}

// ======================================================
// UI
// ======================================================
function showCenterMessage(text) {
    const el = document.createElement("div");

    el.textContent = text;

    el.style.cssText = `
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 42px;
        font-weight: bold;
        background: rgba(255,255,255,0.92);
        padding: 14px 24px;
        border-radius: 16px;
        z-index: 9999;
    `;

    document.body.appendChild(el);

    setTimeout(() => {
        el.remove();
    }, 900);
}

function updateStatusPanel() {
    const progress = document.getElementById("progress");
    const streak = document.getElementById("streak");
    const streakDisplay = document.getElementById("streak_display");
    const speedDisplay = document.getElementById("speed_display");

    if (progress) {
        progress.textContent =
            `${Math.min(currentIndex + 1, flashWords.length)} / ${flashWords.length}`;
    }

    if (streak) {
        streak.textContent = String(consecutiveCorrect);
    }

    if (streakDisplay) {
        streakDisplay.textContent = `連続: ${consecutiveCorrect}`;
    }

    if (speedDisplay) {
        speedDisplay.textContent = `速度: Lv.${speedLevelIndex + 1}`;
    }
}

// ======================================================
// Animation
// ======================================================
function stopFallAnimation() {
    if (fallRafId !== null) {
        cancelAnimationFrame(fallRafId);
        fallRafId = null;
    }

    if (fallEl && fallEl.parentNode) {
        fallEl.remove();
    }

    fallEl = null;
}

function startFallAnimation(text) {
    stopFallAnimation();

    const area = ensureQuestionArea();

    fallEl = document.createElement("div");

    fallEl.className = "falling-word";
    fallEl.textContent = text;

    area.appendChild(fallEl);

    const startY = 0;
    const endY = window.innerHeight + 120;

    fallStartTime = performance.now();

    function tick(now) {

        if (!fallEl) return;

        if (phase !== "playing") return;

        if (questionFinished) return;

        const elapsed = now - fallStartTime;

        const t = Math.min(elapsed / fallDurationMs, 1);

        const y = startY + (endY - startY) * t;

        fallEl.style.top = `${y}px`;

        const input = document.getElementById("input");

        if (input) {

            const inputTop = input.getBoundingClientRect().top;

            // ======================================================
            // 通過時点で即ミス
            // ======================================================
            if (y >= inputTop) {
                handleMiss();
                return;
            }
        }

        if (t < 1) {
            fallRafId = requestAnimationFrame(tick);
        }
    }

    fallRafId = requestAnimationFrame(tick);
}

// ======================================================
// Petal
// ======================================================
function createPetal() {
    try {
        console.log("petal created");

        const petal = document.createElement("img");
        petal.src = "/static/petal.png";

        petal.style.position = "absolute";
        petal.style.top = "-50px";

        const startX = Math.random() * window.innerWidth;
        petal.style.left = startX + "px";

        petal.style.width = "18px";
        petal.style.opacity = "0.9";
        petal.style.pointerEvents = "none";

        const layer = document.getElementById("petal_layer") || document.body;
        layer.appendChild(petal);

        const duration = 4000 + Math.random() * 2000;
        const drift = (Math.random() - 0.5) * 20;
        const start = Date.now();

        function fall() {
            const t = Date.now() - start;
            const progress = t / duration;

            petal.style.top = (progress * window.innerHeight) + "px";
            petal.style.left = (startX + drift * progress) + "px";
            petal.style.transform = `rotate(${progress * 60}deg)`;

            if (progress < 1) {
                requestAnimationFrame(fall);
            } else {
                petal.remove();
            }
        }

        fall();

    } catch (e) {
        console.error("PETAL ERROR", e);
    }
}

// ======================================================
// 判定
// ======================================================
function handleCorrect() {

    if (questionFinished) return;

    questionFinished = true;

    phase = "grading";

    stopFallAnimation();

    // 音はここだけ
    playCorrectSound();

    correctCount += 1;

    consecutiveCorrect += 1;
    consecutiveMiss = 0;

    if (consecutiveCorrect >= 3) {

        consecutiveCorrect = 0;

        if (speedLevelIndex < 2) {
            speedLevelIndex += 1;

            if (currentIndex < flashWords.length - 1) {
                showCenterMessage("速度アップ！");
            }
        }
    }

    showFeedback(true);
}

function handleMiss() {

    if (questionFinished) return;

    questionFinished = true;

    phase = "grading";

    stopFallAnimation();

    // 音はここだけ
    playMissSound();

    consecutiveMiss += 1;
    consecutiveCorrect = 0;

    if (consecutiveMiss >= 2) {

        consecutiveMiss = 0;

        if (speedLevelIndex > 0) {
            speedLevelIndex -= 1;

            if (currentIndex < flashWords.length - 1) {
                showCenterMessage("おちついて");
            }
        }
    }

    mistakes.push({
        kanji: currentQuestion.kanji,
        abbr: currentQuestion.abbr
    });

    showFeedback(false);
}

function showFeedback(isCorrect) {

    const area = ensureQuestionArea();

    area.innerHTML = "";

    const p = document.createElement("p");

    p.className = "flash-feedback";

    p.style.cssText = `
        position:absolute;
        top:35%;
        left:50%;
        transform:translateX(-50%);
        font-size:30px;
        font-weight:bold;
    `;

    p.style.color = isCorrect ? "#1a8f1a" : "#cc2222";

    p.textContent = isCorrect
        ? "〇 正解"
        : `✕ 正解：${currentQuestion.kanji}`;

    area.appendChild(p);

    updateStatusPanel();

    setTimeout(() => {

        currentIndex += 1;

        if (currentIndex >= flashWords.length) {
            finishCase();
            return;
        }

        showQuestion();

    }, FEEDBACK_MS);
}

function checkAnswer() {

    if (phase !== "playing") return;

    if (questionFinished) return;

    const input = document.getElementById("input");

    if (!input) return;

    const expected = normalizeAnswer(currentQuestion.kanji);

    const got = normalizeAnswer(input.value);

    if (got === expected && expected.length > 0) {

        handleCorrect();

    } else {

        handleMiss();
    }
}

// ======================================================
// Question
// ======================================================
function showQuestion() {

    stopFallAnimation();

    if (currentIndex >= flashWords.length) {
        finishCase();
        return;
    }

    questionFinished = false;

    phase = "playing";

    // ======================================================
    // 次問題開始時に速度適用
    // ======================================================
    fallDurationMs = SPEED_LEVELS[speedLevelIndex];

    currentQuestion = flashWords[currentIndex];

    const area = ensureQuestionArea();

    area.innerHTML = "";
    area.style.display = "block";

    setTimeout(() => {
        startFallAnimation(currentQuestion.kanji);
    }, 750);

    const input = document.getElementById("input");

    if (input) {
        input.disabled = false;
        input.value = "";
        input.focus();
    }

    updateStatusPanel();
}

// ======================================================
// Start
// ======================================================
function startCase() {

    primeAudio();

    const department =
        document.getElementById("department").value;

    const level =
        document.getElementById("level").value;

    fetch("/start_case", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            department,
            level
        })
    })
    .then(res => res.json())
    .then(data => {

        flashWords = parseQuestions(data.questions);

        currentIndex = 0;
        currentQuestion = null;

        correctCount = 0;
        mistakes = [];

        consecutiveCorrect = 0;
        consecutiveMiss = 0;

        if (level === "basic") speedLevelIndex = 0;
        if (level === "intermediate") speedLevelIndex = 1;
        if (level === "advanced") speedLevelIndex = 2;

        fallDurationMs = SPEED_LEVELS[speedLevelIndex];

        phase = "idle";
        questionFinished = false;

        document.getElementById("setup").style.display = "none";
        document.getElementById("game").style.display = "block";
        document.getElementById("result").style.display = "none";

        if (petalTimer) {
            clearInterval(petalTimer);
        }

        petalTimer = setInterval(createPetal, 700);

        showQuestion();
    });
}

// ======================================================
// Finish
// ======================================================
function finishCase() {
    phase = "idle";
    questionFinished = true;
    stopFallAnimation();

    console.log("FINISH START");

    // ===== 音（確実に鳴らす） =====
    setTimeout(() => {
        console.log("KOTO PLAY");
        playKoto();
    }, 100);

    // ===== 桜（強制発火） =====
    setTimeout(() => {
        console.log("PETAL START");

        if (petalTimer) clearInterval(petalTimer);

        // 一気に出す
        for (let i = 0; i < 96; i++) {
            setTimeout(() => createPetal(), i * 15);
        }

        // 継続生成（頻度アップ）
        petalTimer = setInterval(() => {
            createPetal();
        }, 120);

        // 5秒後停止
        setTimeout(() => {
            console.log("PETAL STOP");
            if (petalTimer) {
                clearInterval(petalTimer);
                petalTimer = null;
            }
        }, 5000);

    }, 200);

    const game = document.getElementById("game");
    const result = document.getElementById("result");

    if (game) game.style.display = "none";
    if (result) result.style.display = "block";

    const qa = document.getElementById("question_area");

    if (qa) {
        qa.innerHTML = "";
        qa.style.display = "none";
    }

    fetch("/finish_case", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            correct: correctCount,
            total: flashWords.length,
            mistakes
        })
    })
    .then(res => res.json())
    .then(data => {

        const area = document.getElementById("result_area");

        area.innerHTML = `
            <h2 style="text-align:center;">結果</h2>
            <p style="text-align:center;">
                正解数：${correctCount} / ${flashWords.length}
            </p>
            <p style="text-align:center;">
                正答率：${data.accuracy.toFixed(1)}%
            </p>
        `;

        mistakes.forEach(m => {

            const p = document.createElement("p");

            p.style.textAlign = "center";

            p.textContent = m.kanji;

            area.appendChild(p);
        });
    });
}

// ======================================================
// Init
// ======================================================
window.addEventListener("DOMContentLoaded", () => {

    fetch("/departments")
        .then(res => res.json())
        .then(depts => {

            const sel = document.getElementById("department");

            if (!sel) return;

            sel.innerHTML = "";

            depts.forEach(d => {

                const option = document.createElement("option");

                option.value = d;
                option.textContent = DEPT_LABELS[d] || d;

                sel.appendChild(option);
            });
        });

    const input = document.getElementById("input");

    if (input) {

        input.addEventListener("keydown", e => {

            if (e.key === "Enter") {

                e.preventDefault();

                checkAnswer();
            }
        });

        input.addEventListener("pointerdown", primeAudio);
        input.addEventListener("keydown", primeAudio);
    }

    document.getElementById("start_button")
        ?.addEventListener("click", startCase);

    document.getElementById("stop_button")
        ?.addEventListener("click", finishCase);

    document.getElementById("cancel_button")
        ?.addEventListener("click", () => {
            location.reload();
        });

    document.getElementById("reset_button")
        ?.addEventListener("click", () => {
            location.reload();
        });
});
