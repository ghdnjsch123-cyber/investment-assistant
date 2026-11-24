import os
import json
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data, validate_stock_code
from dify_client import ask_dify_chatbot
from quant_engine import calculate_rebalancing_portfolio, calculate_technical_indicators

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

def _is_key_configured(env_name: str, placeholder_prefix: str = "your_") -> bool:
    val = os.getenv(env_name, "").strip()
    return bool(val and not val.startswith(placeholder_prefix))


@app.route("/test")
def test_collector_page():
    """1차 데이터 수집 브리핑 테스트 화면 반환"""
    return render_template("test.html")


@app.route("/health", methods=["GET"])
def health():
    """서버 상태 및 API 키 설정 여부만 반환 (키 값 자체는 절대 노출 금지)"""
    has_serper_key = _is_key_configured("SERPER_API_KEY")
    has_gemini_key = _is_key_configured("GEMINI_API_KEY")
    has_dify_analysis = _is_key_configured("DIFY_ANALYSIS_API_KEY")
    has_dify_technical = _is_key_configured("DIFY_TECHNICAL_API_KEY")

    logger.info(
        "[REQUEST] GET /health (serper=%s, dify_analysis=%s, dify_technical=%s)",
        has_serper_key,
        has_dify_analysis,
        has_dify_technical,
    )

    return jsonify({
        "status": "ok",
        "services": {
            "serper_api_configured": has_serper_key,
            "gemini_api_configured": has_gemini_key,
            "dify_analysis_configured": has_dify_analysis,
            "dify_technical_configured": has_dify_technical,
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


@app.route("/api/chat/analysis", methods=["POST"])
def chat_analysis():
    """[탭1] 종목코드로 수집기(collector.py) 실행 후 Dify 일반 챗봇 ①에 근거 JSON을 전달해 전문가 분석을 받고, 이후 후속 질문을 이어갑니다."""
    payload = request.get_json(silent=True) or {}
    raw_code = payload.get("code", "")
    question = (payload.get("question") or "").strip()
    conversation_id = (payload.get("conversation_id") or "").strip()

    logger.info("[REQUEST] POST /api/chat/analysis code=%s (followup=%s)", raw_code, bool(conversation_id))

    try:
        code = validate_stock_code(raw_code)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        # 이미 해당 종목으로 대화가 시작된 후속 질문인 경우: 재수집 없이 Dify 대화 맥락을 이어감
        if conversation_id and question:
            dify_res = ask_dify_chatbot(
                bot_type="analysis",
                query=question,
                inputs={},
                conversation_id=conversation_id,
            )
            logger.info("[RESPONSE] /api/chat/analysis 후속 질문 완료 (code=%s)", code)
            return jsonify({
                "answer": dify_res["answer"],
                "conversation_id": dify_res["conversation_id"],
                "stock_data": None,
            }), 200

        # 최초 분석: 실시간 데이터 수집 + 전문가/애널리스트 심층 리포트 프롬프트 적용
        stock_data = collect_stock_data(code)
        if not stock_data.get("name"):
            err_msg = stock_data["errors"][0]["message"] if stock_data.get("errors") else "종목 기본 정보를 가져오지 못했습니다."
            return jsonify({"error": err_msg}), 400

        stock_json = json.dumps(stock_data, ensure_ascii=False)
        stock_name = stock_data.get("name", "")
        asset_type = stock_data.get("asset_type", "stock")

        if not question:
            if asset_type == "etf":
                question = (
                    "당신은 주식을 잘 모르는 초보자에게도 친절하게 설명하는 여의도 수석 ETF 애널리스트입니다. "
                    f"아래 실시간 수집 데이터(JSON)만을 근거로 {stock_name}({code}) ETF에 대한 심층 분석 리포트를 작성해 주세요.\n"
                    "어려운 금융 용어(NAV, 괴리율, 총보수 등)가 나올 때마다 반드시 괄호 안에 초보자용 쉬운 비유를 붙여주세요.\n\n"
                    "다음 구조로 깔끔하게 작성해 주세요:\n"
                    "### 1. 📊 핵심 요약\n"
                    "- 지금 이 ETF가 어떤 상품인지, 최근 1년/단기 흐름과 현재 위치를 3줄 이내로 명쾌하게 요약\n"
                    "### 2. 📌 핵심 지표 및 수급 해석\n"
                    "- 현재가, 52주 최저~최고 중 현재 위치(position_52w%), 기초지수, 운용사, 순자산(NAV), 괴리율(실제 가치 대비 비싼지 싼지), 연간 수수료(총보수), 분배금 수익률 설명\n"
                    "### 3. 📈 기간별 수익률 흐름\n"
                    "- 최근 1개월, 3개월, 6개월, 1년 수익률을 비교해 단기 조정인지 장기 상승세인지 쉬운 말로 풀이\n"
                    "### 4. 📰 최신 뉴스 모멘텀 및 시장 이슈\n"
                    "- 제공된 뉴스 5건 기반 핵심 호재와 주의할 점 정리\n"
                    "### 5. ⚖️ 매수 vs 매도 우위 판단 (직접 결론)\n"
                    "- 수집된 데이터를 종합해 현재 **[매수 우위 / 중립 / 매도(관망) 우위]** 중 어느 쪽이 유리한지 직접 결론을 내리고, 매수 우위 근거 vs 매도(리스크) 근거를 숫자로 대비해 제시해 주세요.\n"
                    "마지막으로 사용자가 이어서 후속 질문을 할 수 있도록 안내해 주세요."
                )
            else:
                question = (
                    "당신은 주식을 잘 모르는 초보자에게도 친절하게 설명하는 여의도 수석 애널리스트입니다. "
                    f"아래 실시간 수집 데이터(JSON)만을 근거로 {stock_name}({code})에 대한 심층 분석 리포트를 작성해 주세요.\n"
                    "어려운 금융 용어(PER, PBR, ROE, 부채비율 등)가 나올 때마다 반드시 괄호 안에 초보자용 쉬운 비유를 붙여주세요.\n\n"
                    "다음 구조로 깔끔하게 작성해 주세요:\n"
                    "### 1. 📊 핵심 요약\n"
                    "- 현재 주가 흐름, 가격 위치, 핵심 투자 포인트를 3줄 이내로 명쾌하게 요약\n"
                    "### 2. 📌 핵심 지표 및 수급 동향\n"
                    "- 현재가, 전일대비, 52주 최저~최고 중 현재 위치(position_52w%), 최근 외국인·기관·개인 순매수 수급(investor_trend), 외인소진율 해석\n"
                    "### 3. 📋 밸류에이션 분석 (지금 싼가 비싼가?)\n"
                    "- 현재 PER vs 추정 PER, PBR·BPS, 증권사 목표주가 대비 현재가의 상승 여력(%)을 초보자도 이해하기 쉽게 설명\n"
                    "### 4. 📊 재무 건전성 분석 (돈을 잘 벌고 튼튼한가?)\n"
                    "- 최근 3~5년 매출액·영업이익·영업이익률·ROE·부채비율·영업활동현금흐름 추이 설명 (단, is_consensus가 true인 연도는 반드시 '추정치(E)'로 구분 표시)\n"
                    "### 5. 📰 최신 뉴스 모멘텀 및 이슈\n"
                    "- 제공된 뉴스 5건을 바탕으로 핵심 호재 및 리스크 정리\n"
                    "### 6. ⚖️ 매수 vs 매도 우위 판단 (직접 결론)\n"
                    "- 수집된 데이터를 종합해 현재 **[매수 우위 / 중립 / 매도(관망) 우위]** 중 어느 쪽이 유리한지 직접 결론을 내리고, 매수 우위 근거 vs 매도(리스크) 근거를 숫자로 대비해 제시해 주세요.\n"
                    "마지막으로 사용자가 이어서 후속 질문을 할 수 있도록 안내해 주세요."
                )

        enriched_query = (
            f"[종목 심층 분석 요청: {stock_name} ({code})]\n"
            f"반드시 아래 실시간 수집 데이터(JSON)에 포함된 팩트와 숫자만을 근거로 답변하세요.\n\n"
            f"--- 수집 데이터(JSON) ---\n{stock_json}\n\n"
            f"--- 요청 내용 ---\n{question}"
        )

        dify_res = ask_dify_chatbot(
            bot_type="analysis",
            query=enriched_query,
            inputs={"stock_data": stock_json, "stock_code": code, "stock_name": stock_name},
            conversation_id="",
        )

        logger.info("[RESPONSE] /api/chat/analysis 최초 애널리스트 분석 완료 (code=%s, name=%s)", code, stock_name)
        return jsonify({
            "answer": dify_res["answer"],
            "conversation_id": dify_res["conversation_id"],
            "stock_data": stock_data,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/chat/analysis 실패: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/rebalance", methods=["POST"])
def rebalance_portfolio():
    """[탭2] 종목코드 리스트를 받아 몬테카를로 리밸런싱 비중과 효율적 프론티어를 계산합니다. (Dify 미사용)"""
    payload = request.get_json(silent=True) or {}
    raw_codes = payload.get("codes", [])

    if isinstance(raw_codes, str):
        codes_list = [c.strip() for c in raw_codes.split(",") if c.strip()]
    elif isinstance(raw_codes, list):
        codes_list = [str(c).strip() for c in raw_codes if str(c).strip()]
    else:
        return jsonify({"error": "종목코드 목록 형식이 올바르지 않습니다."}), 400

    logger.info("[REQUEST] POST /api/rebalance codes=%s", codes_list)

    try:
        validated_codes = [validate_stock_code(c) for c in codes_list]
        result = calculate_rebalancing_portfolio(validated_codes)
        logger.info("[RESPONSE] /api/rebalance 완료 (assets=%d)", len(result.get("assets", [])))
        return jsonify(result), 200
    except ValueError as e:
        logger.warning("[ERROR] /api/rebalance 입력 오류: %s", e)
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/rebalance 실패: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/technical/chart", methods=["POST"])
def technical_chart():
    """[탭3] 종목코드를 받아 FDR 기반 주가 및 기술지표(MA, RSI, MACD, 볼린저밴드)를 계산해 반환합니다."""
    payload = request.get_json(silent=True) or {}
    raw_code = payload.get("code", "")

    logger.info("[REQUEST] POST /api/technical/chart code=%s", raw_code)

    try:
        code = validate_stock_code(raw_code)
        result = calculate_technical_indicators(code)
        logger.info("[RESPONSE] /api/technical/chart 완료 (code=%s, name=%s)", code, result.get("name"))
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/technical/chart 실패: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/technical/chat", methods=["POST"])
def technical_chat():
    """[탭3] 계산된 기술지표 숫자를 눈에 안 보이게 Dify 일반 챗봇 ②(지표해석기)에 주입해 설명을 받습니다."""
    payload = request.get_json(silent=True) or {}
    raw_code = payload.get("code", "")
    question = (payload.get("question") or "").strip()
    conversation_id = (payload.get("conversation_id") or "").strip()
    latest = payload.get("latest")
    stock_name = (payload.get("name") or "").strip()

    logger.info("[REQUEST] POST /api/technical/chat code=%s", raw_code)

    try:
        code = validate_stock_code(raw_code)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if not question:
        question = "현재 계산된 이동평균선, 볼린저밴드, RSI, MACD 숫자를 초보자가 이해하기 쉽게 해석해 주세요."

    try:
        if not latest or not isinstance(latest, dict):
            calc = calculate_technical_indicators(code)
            latest = calc["latest"]
            stock_name = stock_name or calc.get("name", code)

        indicators_json = json.dumps(latest, ensure_ascii=False)
        injected_query = (
            f"[기술지표 해석 요청: {stock_name or code} ({code})]\n"
            f"아래 Python이 직접 계산한 최신 기술지표 숫자만을 근거로 초보자에게 알기 쉽게 설명해 주세요.\n\n"
            f"--- 계산된 최신 기술지표 ---\n{indicators_json}\n\n"
            f"--- 사용자 질문 ---\n{question}"
        )

        dify_res = ask_dify_chatbot(
            bot_type="technical",
            query=injected_query,
            inputs={"indicators": indicators_json, "stock_code": code, "stock_name": stock_name or code},
            conversation_id=conversation_id,
        )

        logger.info("[RESPONSE] /api/technical/chat 완료 (code=%s)", code)
        return jsonify({
            "answer": dify_res["answer"],
            "conversation_id": dify_res["conversation_id"],
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/technical/chat 실패: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5050))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info("[START] Flask server starting on http://127.0.0.1:%s (debug=%s)", port, debug)
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=False)
