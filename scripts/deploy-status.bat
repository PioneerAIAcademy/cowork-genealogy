@echo off
REM Windows equivalent of: make deploy-status
REM Health-checks the deployed control plane (expects "db":"postgres")
REM Requires: curl (built into Windows 10+) and jq (install: winget install jqlang.jq)
setlocal
set DEPLOY_URL=https://genealogy-workbench.fly.dev
if not "%DEPLOY_URL_OVERRIDE%"=="" set DEPLOY_URL=%DEPLOY_URL_OVERRIDE%
curl -s %DEPLOY_URL%/api/health | jq
