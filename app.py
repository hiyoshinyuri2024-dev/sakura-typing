from flask import Flask, request, jsonify, render_template
import json
import random
import requests
import os

print("=== DEBUG START ===")
print("現在の作業ディレクトリ:", os.getcwd())
print("このファイルの場所:", os.path.abspath(__file__))
print("templates存在:", os.path.exists("templates"))
print("index.html存在:", os.path.exists("templates/index.html"))
print("=== DEBUG END ===")
print("★★実行中ファイル:", __file__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)

# -----------------------------
# JSON 語彙データの読み込み
# -----------------------------
with open(os.path.join(BASE_DIR, "departments.json"), "r", encoding="utf-8") as f:
    departments = json.load(f)

# -----------------------------
# API: department一覧取得
# -----------------------------
@app.route("/departments", methods=["GET"])
def get_departments():
    return jsonify(list(departments.keys()))

# -----------------------------
# 出題ロジック（10問）
# -----------------------------
def select_questions(dept, level):
    if dept not in departments:
        return []

    if not level:
        level = list(departments[dept].keys())[0]

    if level not in departments[dept]:
        return []

    vocab_list = departments[dept][level]
    if len(vocab_list) >= 10:
        return random.sample(vocab_list, 10)

    # 基本レベル語彙だけでは10問にならない場合は、同じ診療科の他レベルから補完
    questions = vocab_list.copy()
    other_vocab = []
    for lvl, items in departments[dept].items():
        if lvl != level:
            other_vocab.extend(items)
    random.shuffle(other_vocab)
    for word in other_vocab:
        if len(questions) >= 10:
            break
        if word not in questions:
            questions.append(word)

    # それでも10問に満たない場合は同じレベルから重複を許して補完
    while len(questions) < 10:
        questions.append(random.choice(vocab_list))

    return questions


def normalize_question_item(item):
    """
    フラッシュ用の安全な1件: {"kanji": "...", "abbr": "..."}
    departments.json 統一後は dict + 非空 kanji を想定。古い文字列入力も最小限フォロー。
    """
    if item is None:
        return None

    if isinstance(item, str):
        value = item.strip()
        if not value:
            return None
        return {"kanji": value, "abbr": value}

    if isinstance(item, dict):
        kanji = (
            item.get("kanji")
            or item.get("word")
            or item.get("text")
            or item.get("jp")
            or ""
        )
        abbr = item.get("abbr") or item.get("short") or item.get("en") or ""
        kanji = str(kanji).strip()
        abbr = str(abbr).strip()
        if not kanji and abbr:
            kanji = abbr
        if not abbr and kanji:
            abbr = kanji
        if not kanji:
            return None
        return {"kanji": kanji, "abbr": abbr}

    return None


def normalize_questions(raw_questions):
    """
    Ensure questions is always a list of normalized objects.
    """
    if raw_questions is None:
        return []

    if not isinstance(raw_questions, list):
        raw_questions = [raw_questions]

    normalized = []
    for item in raw_questions:
        q = normalize_question_item(item)
        if q is not None:
            normalized.append(q)
    return normalized

# -----------------------------
# Ollama API でコメント生成
# -----------------------------
def generate_comment(prompt):
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": "gemma:2b",
        "prompt": prompt,
        "stream": False
    }
    try:
        response = requests.post(url, json=payload, timeout=5)
        data = response.json()
        return data.get("response", "コメント生成に失敗しました。")
    except Exception as e:
        return f"エラー: {str(e)}"

# -----------------------------
# API: ケース開始（単語モード）
# -----------------------------
@app.route("/start_case", methods=["POST"])
def start_case():
    data = request.json
    dept = data.get("department")
    level = data.get("level")
    mode = data.get("mode")

    raw_questions = select_questions(dept, level)
    questions = normalize_questions(raw_questions)

    return jsonify({
        "questions": questions,
        "mode": mode
    })

# -----------------------------
# ★追加：API: ケースモード（SOAP用）
# -----------------------------
@app.route("/start_case_v2", methods=["POST"])
def start_case_v2():
    data = request.json
    dept = data.get("department")

    # バリデーション
    if dept not in departments:
        return jsonify({"error": "invalid department"}), 400

    case = departments[dept]

    # JSONをそのまま返す（構造を壊さない）
    return jsonify({
        "subjective": case.get("subjective", []),
        "objective": case.get("objective", []),
        "assessment": case.get("assessment", []),
        "tests": case.get("tests", []),
        "plan": case.get("plan", [])
    })

# -----------------------------
# API: ケース終了（AIコメント）
# -----------------------------
@app.route("/finish_case", methods=["POST"])
def finish_case():
    data = request.json
    correct = data.get("correct", 0)
    total = data.get("total", 10)
    mistakes = data.get("mistakes", [])

    accuracy = (correct / total) * 100 if total > 0 else 0
    comment = generate_comment(
        f"医学用語フラッシュ結果: 正解数{correct}/{total}。短く日本語で一言。"
    )

    return jsonify({
        "accuracy": accuracy,
        "comment": comment
    })

# -----------------------------
# API: フラッシュモード
# -----------------------------
@app.route("/flash", methods=["POST"])
def flash_mode():
    data = request.json
    dept = data.get("department")
    level = data.get("level")

    questions = select_questions(dept, level)

    return jsonify({
        "flash": questions
    })

# -----------------------------
# トップページ
# -----------------------------
@app.route("/")
def index():
    return render_template("index.html")

# -----------------------------
# Flask 起動（自動ブラウザ）
# -----------------------------
if __name__ == "__main__":
    import threading, webbrowser, time

    def open_browser():
        url = "http://127.0.0.1:5000"
        time.sleep(5)
        try:
            opened = webbrowser.open(url)
            print("webbrowser.open returned:", opened)
        except Exception as e:
            print("webbrowser.open exception:", e)

    threading.Thread(target=open_browser, daemon=True).start()
    print("Starting Flask on 127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)