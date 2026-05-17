from flask import Flask, request, jsonify, render_template
import json
import random
import os

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

    while len(questions) < 10:
        questions.append(random.choice(vocab_list))

    return questions


def normalize_question_item(item):
    """
    フラッシュ用の安全な1件: {"kanji": "...", "abbr": "..."}
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
# 正答率に応じたコメント生成
# -----------------------------
def generate_comment(accuracy):
    if accuracy == 100:
        return "満点です！素晴らしい！🌸"
    elif accuracy >= 80:
        return "よくできました！あと少しで満点です！🌸"
    elif accuracy >= 60:
        return "なかなかいいですね！練習を続けましょう！"
    elif accuracy >= 40:
        return "もう少しです！繰り返し挑戦してみましょう！"
    else:
        return "難しい用語も多いですが、続けることが大切です！💪"

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
# API: ケースモード（SOAP用）
# -----------------------------
@app.route("/start_case_v2", methods=["POST"])
def start_case_v2():
    data = request.json
    dept = data.get("department")

    if dept not in departments:
        return jsonify({"error": "invalid department"}), 400

    case = departments[dept]

    return jsonify({
        "subjective": case.get("subjective", []),
        "objective": case.get("objective", []),
        "assessment": case.get("assessment", []),
        "tests": case.get("tests", []),
        "plan": case.get("plan", [])
    })

# -----------------------------
# API: ケース終了（コメント）
# -----------------------------
@app.route("/finish_case", methods=["POST"])
def finish_case():
    data = request.json
    correct = data.get("correct", 0)
    total = data.get("total", 10)

    accuracy = (correct / total) * 100 if total > 0 else 0
    comment = generate_comment(accuracy)

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
# Flask 起動
# -----------------------------
if __name__ == "__main__":
    import threading, webbrowser, time

    def open_browser():
        url = "http://127.0.0.1:5000"
        time.sleep(5)
        try:
            webbrowser.open(url)
        except Exception as e:
            print("ブラウザ起動エラー:", e)

    threading.Thread(target=open_browser, daemon=True).start()
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)