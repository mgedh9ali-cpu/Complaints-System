$ErrorActionPreference = 'SilentlyContinue'
$url = 'http://127.0.0.1:3000'
$deadline = (Get-Date).AddSeconds(60)

while ((Get-Date) -lt $deadline) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', 3000)
        $client.Close()
        Start-Process $url
        exit 0
    }
    catch {
        if ($client) { $client.Close() }
        Start-Sleep -Milliseconds 500
    }
}

Write-Host 'Browser was not opened: the local server did not become ready within 60 seconds.'
exit 1
