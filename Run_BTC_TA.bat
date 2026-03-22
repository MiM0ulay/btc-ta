@echo off
title BTC TA Engine Server
cd /d "%~dp0"

echo ===================================================
echo     Starting BTC/USD Expert TA Engine v2 (Local)
echo ===================================================
echo.
echo Launching your default browser to http://localhost:8501...

:: Open the browser immediately (Streamlit might take a second, so browser will just load once ready)
start "" http://localhost:8501

:: Run the Streamlit app
.\.venv312\Scripts\streamlit.exe run app.py

pause
