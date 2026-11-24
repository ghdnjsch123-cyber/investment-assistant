import os
import json
import logging
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from collector import collect_stock_data, validate_stock_code
from dify_client import ask_dify_chatbot
from quant_engine import (
    calculate_rebalancing_portfolio,
    calculate_technical_indicators,
    fetch_naver_chart_with_indicators,
)
from dart_client import fetch_recent_disclosures, search_stock_catalog, resolve_stock_code
from coin_client import search_coins, resolve_coin_market, fetch_coin_chart_with_indicators, collect_coin_data

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
    has_dart_key = _is_key_configured("DART_API_KEY")

    logger.info(
        "[REQUEST] GET /health (serper=%s, dify_analysis=%s, dify_technical=%s, dart=%s)",
        has_serper_key,
        has_dify_analysis,
        has_dify_technical,
        has_dart_key,
    )

    return jsonify({
        "status": "ok",
        "services": {
            "serper_api_configured": has_serper_key,
            "gemini_api_configured": has_gemini_key,
            "dify_analysis_configured": has_dify_analysis,
            "dify_technical_configured": has_dify_technical,
            "dart_api_configured": has_dart_key,
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


@app.route("/api/search", methods=["GET"])
def search_stocks():
    """종목명 또는 코드 일부로 자동완성 후보 목록을 반환합니다."""
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": []}), 200
    try:
        results = search_stock_catalog(q, limit=10)
        return jsonify({"results": results}), 200
    except Exception as e:
        logger.error("[ERROR] /api/search 실패: %s", e)
        return jsonify({"results": []}), 200


@app.route("/api/chart/naver", methods=["POST"])
def naver_timeframe_chart():
    """네이버 증권 차트 API에서 분봉(1/5/10/30/60분)·일·주·월봉 OHLCV 및 지표를 반환합니다."""
    payload = request.get_json(silent=True) or {}
    raw_input = (payload.get("code") or "").strip()
    timeframe = (payload.get("timeframe") or "day").strip()
    code = resolve_stock_code(raw_input)

    logger.info("[REQUEST] POST /api/chart/naver code=%s, timeframe=%s", code, timeframe)

    try:
        validated = validate_stock_code(code)
        chart_data = fetch_naver_chart_with_indicators(validated, timeframe=timeframe)
        return jsonify(chart_data), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/chart/naver 실패: %s", e, exc_info=True)
        return jsonify({"error": "차트 데이터를 불러오는 중 오류가 발생했습니다."}), 500


@app.route("/api/chat/analysis", methods=["POST"])
def chat_analysis():
    """[탭1] 종목코드 또는 종목명으로 수집기 실행 후 Dify 일반 챗봇 ①에 근거 JSON을 전달합니다."""
    payload = request.get_json(silent=True) or {}
    raw_input = (payload.get("code") or "").strip()
    raw_code = resolve_stock_code(raw_input)
    question = (payload.get("question") or "").strip()
    conversation_id = (payload.get("conversation_id") or "").strip()

    logger.info("[REQUEST] POST /api/chat/analysis input=%s -> code=%s (followup=%s)", raw_input, raw_code, bool(conversation_id))

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

        # 최초 분석: 실시간 데이터 + 기술지표 + 시장환경 통합 수집 후 종합 리포트 생성
        stock_data = collect_stock_data(code)
        if not stock_data.get("name"):
            err_msg = stock_data["errors"][0]["message"] if stock_data.get("errors") else "종목 기본 정보를 가져오지 못했습니다."
            return jsonify({"error": err_msg}), 400

        # 탭 1에서도 기술지표(RSI, MACD, 이동평균선, 볼린저밴드 위치%) 및 최근 120일 트레이딩뷰 캔들 데이터 계산
        tech_series = {}
        is_foreign = stock_data.get("market_country") == "US"
        try:
            tech_calc = calculate_technical_indicators(
                code, days=365, display_days=120, is_foreign=is_foreign
            )
            tech_latest = tech_calc.get("latest", {})
            tech_series = tech_calc.get("series", {})
            bb_up = tech_latest.get("bb_upper")
            bb_lo = tech_latest.get("bb_lower")
            close_p = tech_latest.get("close")
            if bb_up and bb_lo and close_p and bb_up > bb_lo:
                bb_pos = ((close_p - bb_lo) / (bb_up - bb_lo)) * 100.0
                tech_latest["bb_position_pct"] = round(max(0.0, min(100.0, bb_pos)), 1)
            stock_data["technical"] = tech_latest

            # 네이버 실시간 시세(현재가·시가·고가·저가·거래량)가 있으면 마지막 캔들에 실시간 반영
            snap = stock_data.get("snapshot") or {}
            ohlcv = tech_series.get("ohlcv") or []
            if ohlcv and snap.get("current_price"):
                last_candle = ohlcv[-1]
                last_candle["close"] = snap["current_price"]
                if snap.get("open_price"):
                    last_candle["open"] = snap["open_price"]
                if snap.get("high_price"):
                    last_candle["high"] = snap["high_price"]
                if snap.get("low_price"):
                    last_candle["low"] = snap["low_price"]
                if snap.get("volume"):
                    last_candle["volume"] = snap["volume"]
        except Exception as tech_err:
            logger.warning("[QUANT] 탭1 기술지표 보조 계산 실패 (무시하고 진행): %s", tech_err)
            stock_data["technical"] = {}

        # Open DART 최근 90일 주요 공시 조회 (일반 주식일 때)
        if stock_data.get("asset_type") != "etf":
            try:
                stock_data["disclosures"] = fetch_recent_disclosures(code, days=90, limit=8)
            except Exception as dart_err:
                logger.warning("[DART] 공시 조회 실패 (무시하고 진행): %s", dart_err)
                stock_data["disclosures"] = []
        else:
            stock_data["disclosures"] = []

        stock_json = json.dumps(stock_data, ensure_ascii=False)
        stock_data["tech_series"] = tech_series
        try:
            stock_data["tv_chart"] = fetch_naver_chart_with_indicators(
                code, timeframe="day", is_foreign=is_foreign
            )
        except Exception:
            stock_data["tv_chart"] = None
        stock_name = stock_data.get("name", "")
        asset_type = stock_data.get("asset_type", "stock")

        if not question:
            if is_foreign:
                question = (
                    "당신은 주식을 잘 모르는 초보자에게도 친절하게 설명하는 글로벌/미국 주식 수석 애널리스트입니다. "
                    f"아래 실시간 수집 데이터(JSON)만을 근거로 미국 종목 {stock_name}({code})에 대한 종합 분석 리포트를 작성해 주세요. "
                    "(모든 주가·목표주가·EPS·BPS는 미국 달러 USD($) 기준입니다.)\n"
                    "어려운 금융 용어(PER, PBR, RSI, MACD, 볼린저밴드 등)가 나올 때마다 반드시 괄호 안에 초보자용 쉬운 비유를 붙여주세요.\n\n"
                    "다음 구조로 깔끔하게 작성해 주세요:\n"
                    "### 1. 📊 핵심 답변 요약\n"
                    "- 오늘 미국 종목의 가격 흐름, 52주 내 위치(position_52w%), 핵심 포인트를 3줄 이내로 명쾌하게 요약\n"
                    "### 2. 🌐 시장 환경 및 핵심 지표\n"
                    "- 원/달러 환율 및 시가총액(market_cap_display), 거래량, 52주 최고/최저 대비 현재 위치 설명\n"
                    "### 3. 📈 가격 추이 및 기술지표 분석\n"
                    "- technical 데이터(20일/60일 이동평균선, RSI14, MACD, 볼린저밴드 위치%)를 바탕으로 단기 과열/저가 구간 여부를 쉽게 설명\n"
                    "### 4. 📋 밸류에이션 분석 (지금 싼가 비싼가?)\n"
                    "- 현재 PER, PBR, EPS, BPS 및 월가 애널리스트 평균 목표주가(target_price, 달러) 대비 현재가의 상승 여력(%) 설명\n"
                    "### 5. 📰 최신 뉴스 모멘텀 및 이슈\n"
                    "- 제공된 뉴스 5건을 바탕으로 핵심 호재 및 리스크 정리\n"
                    "### 6. ⚖️ 매수 vs 매도 우위 판단 (직접 결론)\n"
                    "- 수집된 데이터를 종합해 현재 **[매수 우위 / 중립 / 매도(관망) 우위]** 중 어느 쪽이 유리한지 직접 결론을 내리고, 매수 우위 근거 vs 매도(리스크) 근거를 숫자로 대비해 제시해 주세요."
                )
            elif asset_type == "etf":
                question = (
                    "당신은 주식을 잘 모르는 초보자에게도 친절하게 설명하는 여의도 수석 ETF 애널리스트입니다. "
                    f"아래 실시간 수집 데이터(JSON)만을 근거로 {stock_name}({code}) ETF에 대한 종합 분석 리포트를 작성해 주세요.\n"
                    "어려운 금융 용어(NAV, 괴리율, 총보수, RSI, 볼린저밴드 등)가 나올 때마다 반드시 괄호 안에 초보자용 쉬운 비유를 붙여주세요.\n\n"
                    "다음 구조로 깔끔하게 작성해 주세요:\n"
                    "### 1. 📊 핵심 답변 요약\n"
                    "- 오늘 시장(코스피/코스닥) 분위기 속에서 이 ETF가 어떤 흐름인지, 기술적 위치와 함께 3줄 이내로 명쾌하게 요약\n"
                    "### 2. 🌐 시장 환경 및 핵심 지표·수급\n"
                    "- 시장(코스피·코스닥·원/달러 환율), 기초지수, 운용사, 순자산(NAV), 괴리율(정가 여부), 총보수, 분배금, 52주 가격 위치(position_52w%) 풀이\n"
                    "### 3. 📈 가격 추이 및 기술지표 분석\n"
                    "- technical 데이터(20일/60일 이동평균선, RSI14, MACD, 볼린저밴드 위치%)를 바탕으로 현재 단기 과열인지 과매도(저가 구간)인지 쉬운 말로 설명\n"
                    "### 4. 📊 기간별 수익률 및 최신 뉴스\n"
                    "- 최근 1개월·3개월·6개월·1년 수익률 비교 및 최신 뉴스 5건 기반 호재·주의점 정리\n"
                    "### 5. ⚖️ 매수 vs 매도 우위 판단 (직접 결론)\n"
                    "- 수집된 데이터를 종합해 현재 **[매수 우위 / 중립 / 매도(관망) 우위]** 중 어느 쪽이 유리한지 직접 결론을 내리고, 매수 우위 근거 vs 매도(리스크) 근거를 숫자로 대비해 제시해 주세요."
                )
            else:
                question = (
                    "당신은 주식을 잘 모르는 초보자에게도 친절하게 설명하는 여의도 수석 애널리스트입니다. "
                    f"아래 실시간 수집 데이터(JSON)만을 근거로 {stock_name}({code})에 대한 종합 분석 리포트를 작성해 주세요.\n"
                    "어려운 금융 용어(PER, PBR, ROE, RSI, MACD, 볼린저밴드 등)가 나올 때마다 반드시 괄호 안에 초보자용 쉬운 비유를 붙여주세요.\n\n"
                    "다음 구조로 깔끔하게 작성해 주세요:\n"
                    "### 1. 📊 핵심 답변 요약\n"
                    "- 오늘 시장 분위기 속에서 이 종목의 가격 위치, 수급, 밸류에이션 핵심을 3줄 이내로 명쾌하게 요약\n"
                    "### 2. 🌐 시장 환경 및 수급 동향\n"
                    "- 시장(코스피·코스닥·원/달러 환율) 현황과 최근 외국인·기관·개인 순매수 수급(investor_trend), 외인소진율 해석\n"
                    "### 3. 📈 기술지표 및 가격 위치 분석\n"
                    "- 52주 위치(position_52w%)와 technical 데이터(20일/60일 이동평균선, RSI14, MACD, 볼린저밴드 위치%)를 바탕으로 단기 흐름과 지지/저항 구간을 쉽게 설명\n"
                    "### 4. 📋 밸류에이션 분석 (지금 싼가 비싼가?)\n"
                    "- 현재 PER vs 추정 PER, PBR·BPS, 증권사 목표주가 대비 현재가의 상승 여력(%)을 초보자도 이해하기 쉽게 설명\n"
                    "### 5. 📊 재무 건전성 및 최신 공시·뉴스\n"
                    "- 최근 3~5년 매출·영업이익·ROE·부채비율·영업활동현금흐름 추이(is_consensus가 true면 '추정치(E)' 명시), Open DART 주요 공시(disclosures) 및 최신 뉴스 5건 핵심 호재·리스크 정리\n"
                    "### 6. ⚖️ 매수 vs 매도 우위 판단 (직접 결론)\n"
                    "- 수집된 데이터를 종합해 현재 **[매수 우위 / 중립 / 매도(관망) 우위]** 중 어느 쪽이 유리한지 직접 결론을 내리고, 매수 우위 근거 vs 매도(리스크) 근거를 숫자로 대비해 제시해 주세요."
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


@app.route("/api/coin/search", methods=["GET"])
def coin_search():
    """[탭4] 업비트 원화 마켓 코인 자동완성 후보를 반환합니다."""
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": []}), 200
    try:
        return jsonify({"results": search_coins(q, limit=10)}), 200
    except Exception as e:
        logger.error("[ERROR] /api/coin/search 실패: %s", e)
        return jsonify({"results": []}), 200


@app.route("/api/coin/chart", methods=["POST"])
def coin_timeframe_chart():
    """[탭4] 바이낸스 USDT 현물/선물 분봉/일/주/월봉 캔들 및 32종+ 기술지표를 반환합니다."""
    payload = request.get_json(silent=True) or {}
    raw_query = (payload.get("market") or "").strip()
    timeframe = (payload.get("timeframe") or "day").strip()
    market_type = (payload.get("market_type") or "spot").strip()

    try:
        info = resolve_coin_market(raw_query)
        chart_data = fetch_coin_chart_with_indicators(
            info["market"], timeframe=timeframe, market_type=market_type
        )
        return jsonify(chart_data), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/coin/chart 실패: %s", e, exc_info=True)
        return jsonify({"error": "코인 차트 데이터를 불러오는 중 오류가 발생했습니다."}), 500


@app.route("/api/coin/analysis", methods=["POST"])
def coin_analysis():
    """[탭4] 바이낸스 USDT 현물/선물·펀딩비 코인 종합 데이터 수집 후 Dify 일반 챗봇 ①로 심층 리포트 및 후속 질문을 처리합니다."""
    payload = request.get_json(silent=True) or {}
    raw_query = (payload.get("market") or "").strip()
    question = (payload.get("question") or "").strip()
    conversation_id = (payload.get("conversation_id") or "").strip()

    logger.info("[REQUEST] POST /api/coin/analysis market=%s (followup=%s)", raw_query, bool(conversation_id))

    try:
        if conversation_id and question:
            dify_res = ask_dify_chatbot(
                bot_type="analysis",
                query=question,
                inputs={},
                conversation_id=conversation_id,
            )
            return jsonify({
                "answer": dify_res["answer"],
                "conversation_id": dify_res["conversation_id"],
                "coin_data": None,
            }), 200

        coin_data = collect_coin_data(raw_query)
        tv_chart = coin_data.pop("tv_chart", None)
        coin_json = json.dumps(coin_data, ensure_ascii=False)
        coin_info = coin_data.get("coin_info") or {}
        coin_name = coin_info.get("korean_name") or coin_info.get("symbol") or raw_query
        market = coin_info.get("usdt_symbol") or raw_query

        if not question:
            question = (
                "당신은 암호화폐 초보자에게도 친절하게 설명하는 가상자산 현물·선물 수석 애널리스트입니다. "
                f"아래 바이낸스 USDT 실시간 수집 데이터(JSON)만을 근거로 {coin_name}({market}) 코인에 대한 종합 분석 리포트를 작성해 주세요.\n"
                "어려운 용어(펀딩비, 미결제약정, 베이시스, 김치프리미엄, 공포탐욕지수, RSI 등)가 나올 때마다 반드시 괄호 안에 초보자용 쉬운 비유를 붙여주세요.\n\n"
                "다음 구조로 깔끔하게 작성해 주세요:\n"
                "### 1. 📊 핵심 답변 요약\n"
                "- 현재 USDT 현물 가격 흐름, 구간 위치(range_position_pct%), 시장 심리를 3줄 이내로 명쾌하게 요약\n"
                "### 2. 🏦 현물 vs ⚡ 선물 시장 & 펀딩비 분석\n"
                "- **현물(Spot)**: 현재가($), 24시간 등락률, 24시간 거래대금(USDT) 정리\n"
                "- **선물(Futures)**: 마크가격/인덱스가격, 베이시스(basis_pct%), **펀딩비(funding_rate_pct%, 연환산, 롱/숏 쏠림)**, **미결제약정(open_interest_usdt)**, 현물 대비 선물 거래대금 비율(fut_spot_vol_ratio배)을 초보자도 이해하기 쉽게 해설\n"
                "### 3. 🎯 롱/숏 청산 로드맵 (스퀴즈 위험 구간)\n"
                "- **롱/숏 비율**: 글로벌 계정(global_long_pct vs global_short_pct) 및 상위 트레이더 포지션(top_long_pct vs top_short_pct)\n"
                "- **청산 로드맵(liquidation_roadmap)**: 상방 숏 스퀴즈 예상 구간(short_squeeze_levels)과 하방 롱 청산 위험 구간(long_squeeze_levels)의 핵심 가격대($)와 규모(USDT)를 짚어주고, 어느 쪽 청산 압력이 더 큰지(squeeze_diagnosis) 설명\n"
                "### 4. 😨 시장 심리, 비트코인 도미넌스 및 김치프리미엄\n"
                "- 공포·탐욕 지수(fear_greed: 오늘·어제·지난주·지난달 변화), **비트코인 도미넌스(btc_dominance%)**와 자금 흐름(BTC 집중 vs 알트 순환매), 업비트 기준 김치프리미엄(kimchi.premium_pct%) 풀이\n"
                "### 5. 📈 가격 추이 및 기술지표 분석\n"
                "- technical 데이터(20일/60일 이동평균선, RSI14, MACD, 볼린저밴드)를 바탕으로 단기 과매도/과열 여부를 쉽게 설명\n"
                "### 6. 📰 최신 코인 뉴스 모멘텀 및 이슈\n"
                "- 제공된 최신 뉴스 기반 호재·악재 정리\n"
                "### 7. ⚖️ 매수 vs 매도 우위 판단 (직접 결론)\n"
                "- 수집된 현물·선물·펀딩비·청산 로드맵·기술지표 데이터를 종합해 현재 **[매수 우위 / 중립 / 매도(관망) 우위]** 중 어느 쪽이 유리한지 직접 결론을 내리고, 매수 우위 근거 vs 매도(리스크) 근거를 숫자로 대비해 제시해 주세요."
            )

        enriched_query = (
            f"[코인 현물·선물 심층 분석 요청: {coin_name} ({market})]\n"
            f"반드시 아래 실시간 수집 데이터(JSON)에 포함된 팩트와 숫자만을 근거로 답변하세요.\n\n"
            f"--- 수집 데이터(JSON) ---\n{coin_json}\n\n"
            f"--- 요청 내용 ---\n{question}"
        )

        dify_res = ask_dify_chatbot(
            bot_type="analysis",
            query=enriched_query,
            inputs={"stock_data": coin_json, "stock_code": market, "stock_name": coin_name},
            conversation_id="",
        )

        coin_data["tv_chart"] = tv_chart
        logger.info("[RESPONSE] /api/coin/analysis 완료 (market=%s)", market)
        return jsonify({
            "answer": dify_res["answer"],
            "conversation_id": dify_res["conversation_id"],
            "coin_data": coin_data,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error("[ERROR] /api/coin/analysis 실패: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5050))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    logger.info("[START] Flask server starting on http://127.0.0.1:%s (debug=%s)", port, debug)
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=False)
