@echo off
chcp 65001 >nul

:: 请根据你的本地环境修改以下路径
set "JAVA_HOME=C:\Program Files\Java\jdk-17"
set "ANDROID_HOME=C:\Users\%USERNAME%\AppData\Local\Android\Sdk"
set "GRADLE_HOME=C:\gradle-8.11.1"

set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%GRADLE_HOME%\bin;%PATH%"

cd /d "%~dp0"
gradle.bat assembleDebug --no-daemon > build.log 2>&1
echo BUILD_EXIT_CODE=%ERRORLEVEL% >> build.log
