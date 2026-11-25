@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==================================================
echo  My Investment Assistant - Windows 자동 설치/실행
echo ==================================================

if not exist "venv\Scripts\python.exe" (
    echo [1/4] Python 가상환경(venv) 생성 중...
    python -m venv venv
    if errorlevel 1 (
        echo [오류] Python이 설치되어 있지 않거나 PATH에 없습니다.
        pause
        exit /b 1
    )
)

echo [2/4] 필수 패키지 설치/업데이트 중...
call venv\Scripts\python.exe -m pip install --upgrade pip >nul
call venv\Scripts\pip.exe install -r requirements.txt
if errorlevel 1 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
)

if not exist ".env" (
    if exist ".env.example" (
        echo [3/4] .env.example 에서 .env 파일 생성 중...
        copy ".env.example" ".env" >nul
    )
)

echo [4/4] 서버 시작 중... (http://127.0.0.1:5050)
start "" http://127.0.0.1:5050
venv\Scripts\python.exe app.py
pause
