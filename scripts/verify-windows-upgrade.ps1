# Run only on the disposable Windows Actions runner.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This upgrade check requires a disposable GitHub-hosted runner.'
}
$work = Join-Path $env:RUNNER_TEMP ("complaints-upgrade-" + [guid]::NewGuid())
$null = New-Item $work -ItemType Directory
$profileDir = Join-Path $work 'profile'
$installDir = Join-Path $work 'application'
$oldSetup = Join-Path $work 'previous.exe'
$tag = 'v1.0.0-rc.20-build.4fff518c1f255642db3ccd52f3a41f16fb3cdc4b'
Invoke-WebRequest "https://github.com/mgedh9ali-cpu/Complaints-System/releases/download/$tag/complaints-system-1.0.0-rc.20-setup.exe" -OutFile $oldSetup
if ((Get-FileHash $oldSetup).Hash -ne 'bf97d0e88c9efa8c76e81d0cbedb9f4099b233e88204c09dfc2a4df594dcf95c') { throw 'Previous installer checksum mismatch' }
$package = Get-Content package.json -Raw | ConvertFrom-Json
$newSetup = (Get-Item "dist-desktop/complaints-system-$($package.version)-setup.exe").FullName
$exe = Join-Path $installDir ($package.build.productName + '.exe')
$env:ADMIN_USERNAME = 'upgrade_owner'
$env:ADMIN_PASSWORD = 'Upgrade-test-' + [guid]::NewGuid()
$env:PORT = '39127'
$base = 'http://127.0.0.1:39127'
$ids = @{}
foreach ($setup in @($oldSetup, $newSetup)) {
    $installer = Start-Process $setup -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
    if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)" }
    if ($setup -eq $newSetup -and (Get-FileHash $exe).Hash -ne (Get-FileHash (Join-Path 'dist-desktop/win-unpacked' ($package.build.productName + '.exe'))).Hash) { throw 'Installed executable does not match the new build' }
    $application = Start-Process $exe -ArgumentList ('--user-data-dir="' + $profileDir + '"') -PassThru
    try {
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($application.HasExited) { throw 'Installed app exited unexpectedly' }
            try { $null = Invoke-RestMethod "$base/api/health" -TimeoutSec 2; $ready = $true; break } catch { Start-Sleep -Milliseconds 500 }
        }
        if (!$ready) { throw 'Installed app failed to start' }
        $login = @{username=$env:ADMIN_USERNAME; password=$env:ADMIN_PASSWORD} | ConvertTo-Json
        $null = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body $login -SessionVariable session
        $csrf = (Invoke-RestMethod "$base/api/csrf" -WebSession $session).csrfToken
        if ($setup -eq $oldSetup) {
            foreach ($type in @('complaint','inquiry','contact')) {
                $body = @{recordType=$type;summary="Upgrade test $type";province='دمشق';category='استفسار عام'} | ConvertTo-Json
                $created = Invoke-RestMethod "$base/api/complaints" -Method Post -WebSession $session -Headers @{'X-CSRF-Token'=$csrf} -ContentType 'application/json; charset=utf-8' -Body $body
                $ids[$type] = $created.complaint.id
            }
        } else {
            $records = (Invoke-RestMethod "$base/api/state" -WebSession $session).state.complaints
            foreach ($type in $ids.Keys) {
                $match = @($records | Where-Object { $_.id -eq $ids[$type] -and $_.recordType -eq $type -and $_.summary -eq "Upgrade test $type" })
                if ($match.Count -ne 1) { throw "Record lost or changed during upgrade: $type" }
            }
        }
    } finally {
        if (!$application.HasExited) { $application.Kill($true); $application.WaitForExit() }
    }
}
Write-Host 'Verified upgrade from published rc.20, owner login and all three persisted record types.'
