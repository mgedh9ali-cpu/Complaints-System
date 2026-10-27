$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3000'
$deadline = (Get-Date).AddSeconds(90)

function Find-Browser {
    $commands = @(
        @{ Name = 'msedge.exe'; Args = @('--new-window', $url) },
        @{ Name = 'chrome.exe'; Args = @('--new-window', $url) },
        @{ Name = 'firefox.exe'; Args = @('-new-window', $url) }
    )

    foreach ($browser in $commands) {
        $command = Get-Command $browser.Name -ErrorAction SilentlyContinue
        if ($command) {
            return @{ Path = $command.Source; Args = $browser.Args }
        }
    }

    $candidates = @(
        @{ Path = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"; Args = @('--new-window', $url) },
        @{ Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; Args = @('--new-window', $url) },
        @{ Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; Args = @('--new-window', $url) },
        @{ Path = "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe"; Args = @('--new-window', $url) },
        @{ Path = "$env:ProgramFiles\Mozilla Firefox\firefox.exe"; Args = @('-new-window', $url) },
        @{ Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; Args = @('--new-window', $url) }
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate.Path) {
            return $candidate
        }
    }
    return $null
}

while ((Get-Date) -lt $deadline) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', 3000)
        $client.Close()
        $client = $null

        $browser = Find-Browser
        if ($browser) {
            Start-Process -FilePath $browser.Path -ArgumentList $browser.Args
        } else {
            # Windows default browser is the final fallback; it may reuse an existing window.
            Start-Process $url
        }
        exit 0
    } catch {
        if ($client) { $client.Close() }
        Start-Sleep -Milliseconds 500
    }
}

Write-Error 'لم يصبح الخادم المحلي جاهزاً خلال 90 ثانية. لم يتم فتح المتصفح.'
exit 1
