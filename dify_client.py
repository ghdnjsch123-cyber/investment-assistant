import os
import logging
import requests
from dotenv import load_dotenv

_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_ENV_PATH):
    load_dotenv(_ENV_PATH, override=True)
else:
    load_dotenv()

logger = logging.getLogger("StockAssistant")

BOT_KEY_ENV_MAP = {
    "analysis": "DIFY_ANALYSIS_API_KEY",
    "technical": "DIFY_TECHNICAL_API_KEY",
}


def _get_dify_api_key(bot_type: str) -> str:
    """봇 유형(analysis | technical)에 맞는 Dify API Key를 안전하게 조회합니다."""
    if bot_type not in BOT_KEY_ENV_MAP:
        raise ValueError(f"지원하지 않는 챗봇 유형입니다: {bot_type}")

    env_name = BOT_KEY_ENV_MAP[bot_type]
    api_key = os.getenv(env_name, "").strip()
    if not api_key or api_key.startswith("your_"):
        raise ValueError(f"{env_name}가 설정되지 않았습니다. .env 파일을 확인해 주세요.")
    return api_key


def ask_dify_chatbot(
    bot_type: str,
    query: str,
    inputs: dict = None,
    conversation_id: str = "",
    user_id: str = "investment-user",
) -> dict:
    """Dify 일반 챗봇 API(/chat-messages)를 호출하여 답변과 conversation_id를 반환합니다."""
    if not query or not str(query).strip():
        raise ValueError("질문 내용이 비어 있습니다.")

    api_key = _get_dify_api_key(bot_type)
    base_url = os.getenv("DIFY_BASE_URL", "https://api.dify.ai/v1").rstrip("/")
    url = f"{base_url}/chat-messages"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "inputs": inputs or {},
        "query": str(query).strip(),
        "response_mode": "blocking",
        "conversation_id": conversation_id or "",
        "user": user_id,
    }

    logger.info(
        "[DIFY] Dify 일반 챗봇 API 호출 시작 (bot=%s, conversation_id=%s)",
        bot_type,
        conversation_id or "new",
    )

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=60)
    except requests.Timeout as e:
        raise TimeoutError("Dify 챗봇 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.") from e
    except requests.RequestException as e:
        raise ConnectionError(f"Dify API 서버에 연결할 수 없습니다: {e}") from e

    if resp.status_code in (401, 403):
        raise PermissionError("Dify API Key가 유효하지 않거나 접근 권한이 없습니다.")
    if resp.status_code == 429:
        raise RuntimeError("Dify API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.")
    if resp.status_code != 200:
        detail = ""
        try:
            detail = resp.json().get("message", "")
        except ValueError:
            detail = resp.text[:200]
        raise RuntimeError(f"Dify API 호출 실패 (HTTP {resp.status_code}): {detail}")

    try:
        data = resp.json()
    except ValueError as e:
        raise ValueError("Dify API 응답을 JSON으로 해석하는 데 실패했습니다.") from e

    answer = data.get("answer", "")
    new_conv_id = data.get("conversation_id", "")

    logger.info("[DIFY] Dify 응답 수신 완료 (bot=%s, answer_len=%d)", bot_type, len(answer))
    return {
        "answer": answer,
        "conversation_id": new_conv_id,
    }
