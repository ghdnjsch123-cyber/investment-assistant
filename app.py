import os
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data, validate_stock_code

# .env 환경변수 로드
load_dotenv()

# 로깅 설정 (print 대신 logging 모듈 사용)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("StockAssistant")

app = Flask(__name__)

@app.route("/")
def index():
    # 추후 Step 17에서 index.html을 작성하면 render_template('index.html')로 동작
    if os.path.exists(os.path.join(app.template_folder, "index.html")):
        return render_template("index.html")
    return jsonify({
        "status": "ready",
        "message": "Stock Data Collector & Briefing Tool backend is running."
    })

@app.route("/health", methods=["GET"])
def health():
    """서버 상태 및 API 키 설정 여부만 반환 (키 값 자체는 절대 노출 금지)"""
    serper_key = os.getenv("SERPER_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    has_serper_key = bool(serper_key and serper_key != "your_serper_api_key_here")
    has_gemini_key = bool(gemini_key and gemini_key != "your_gemini_api_key_here")

    logger.info("[REQUEST] GET /health (serper=%s, gemini=%s)", has_serper_key, has_gemini_key)

    return jsonify({
        "status": "ok",
        "services": {
            "serper_api_configured": has_serper_key,
            "gemini_api_configured": has_gemini_key
        }
    })


@app.route("/fetch", methods=["POST"])
def fetch_stock():
    """종목코드를 받아 네이버 증권 데이터와 Serper 뉴스를 통합 수집해 JSON으로 반환합니다."""
    payload = request.get_json(silent=True) or {}
    raw_code = payload.get("code", "")

    logger.info("[REQUEST] POST /fetch code=%s", raw_code)

    try:
        code = validate_stock_code(raw_code)
    except ValueError as e:
        logger.warning("[ERROR] 잘못된 종목코드 입력 (code=%s): %s", raw_code, e)
        return jsonify({"error": str(e)}), 400

    try:
        data = collect_stock_data(code)
        logger.info(
            "[RESPONSE] 수집 성공 / name=%s, financials=%d, news=%d, errors=%d",
            data.get("name"),
            len(data.get("financials", [])),
            len(data.get("news", [])),
            len(data.get("errors", [])),
        )
        return jsonify(data), 200
    except Exception as e:
        logger.error("[ERROR] 수집 실패: %s", e, exc_info=True)
        return jsonify({"error": "데이터 수집 중 서버 내부 오류가 발생했습니다."}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info("[START] Flask server starting on http://127.0.0.1:%s (debug=%s)", port, debug)
    app.run(host="127.0.0.1", port=port, debug=debug)
