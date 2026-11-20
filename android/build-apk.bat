@echo off
chcp 65001 >nul
setlocal

rem 请先配置 JAVA_HOME；Gradle 默认使用 wrapper，也可设置 GRADLE_HOME 使用本地 Gradle。
cd /d "%~dp0\.."

call node build-local.js
if errorlevel 1 exit /b 1

call npx cap update android
if errorlevel 1 exit /b 1

copy /y "dist\mian-password-local.html" "android\app\src\main\assets\public\index.html" >nul
copy /y "dist\mian-password-local.html" "android\app\src\main\assets\public\mian-password-local.html" >nul

cd android
if defined GRADLE_HOME (
  call "%GRADLE_HOME%\bin\gradle.bat" assembleDebug --no-daemon
) else (
  call gradlew.bat assembleDebug --no-daemon
)
if errorlevel 1 exit /b 1

cd /d "%~dp0\.."
copy /y "android\app\build\outputs\apk\debug\app-debug.apk" "dist\密安密码本.apk" >nul
echo APK built: dist\密安密码本.apk
endlocal
