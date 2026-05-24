# Wrapper that runs the Cue swarm hidden so Windows Task Scheduler doesn't flash a console.
# Triggered by the scheduled task "Cue-Swarm" every 15 minutes.

$ErrorActionPreference = 'Continue'
$logDir = 'C:\Cue\scripts\_swarm-state'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'task-scheduler.log'
$ts = (Get-Date).ToString('s')
"`n[$ts] swarm tick" | Out-File -Append -FilePath $logFile -Encoding utf8

try {
  $node = (Get-Command node -ErrorAction Stop).Source
  & $node 'C:\Cue\scripts\swarm.mjs' 2>&1 | Out-File -Append -FilePath $logFile -Encoding utf8
} catch {
  "[$ts] ERROR: $($_.Exception.Message)" | Out-File -Append -FilePath $logFile -Encoding utf8
}
