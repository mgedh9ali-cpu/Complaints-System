param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
try {
  $parentProcess = Get-Process -Id $settings.pid -ErrorAction SilentlyContinue
  if ($parentProcess -and -not $parentProcess.WaitForExit(120000)) { throw 'Application did not close. No update installed.' }
  $hash = (Get-FileHash -LiteralPath $settings.installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $settings.sha256) { throw 'Installer checksum changed. No update installed.' }
  Write-Host 'Installing update. Your database and attachments are kept in the application data folder.'
  # The one-click installer displays its real installation progress and reopens the app.
  $installerProcess = Start-Process -FilePath $settings.installer -ArgumentList @('--force-run') -PassThru -Wait
  if ($installerProcess.ExitCode -ne 0) { throw ('Installation failed: ' + $installerProcess.ExitCode) }
} catch {
  $_.Exception.Message | Set-Content -LiteralPath ($Config + '.error')
  Write-Error $_
  exit 1
}
