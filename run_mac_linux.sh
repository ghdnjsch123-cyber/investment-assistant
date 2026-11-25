#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "=================================================="
echo " My Investment Assistant - Mac/Linux 자동 실행"
echo "=================================================="

if [ ! -x "venv/bin/python" ]; then
  echo "[1/4] Python 가상환경(venv) 생성 중..."
  python3 -m venv venv
fi

echo "[2/4] 필수 패키지 설치/업데이트 중..."
./venv/bin/python -m pip install --upgrade pip >/dev/null
./venv/bin/pip install -r requirements.txt

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  echo "[3/4] .env.example 에서 .env 파일 생성 중..."
  cp .env.example .env
fi

echo "[4/4] 서버 시작 중... (http://127.0.0.1:5050)"
./venv/bin/python app.py
