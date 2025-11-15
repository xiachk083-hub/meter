param(
    [Parameter(Position=0)]
    [string]$Text,
    [string]$File,
    [switch]$Compact
)

$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Text) {
    if ($File) {
        if (Test-Path $File) {
            $Text = Get-Content -Raw -Path $File
        } else {
            Write-Error "文件不存在: $File"
            exit 1
        }
    } else {
        $Text = Read-Host "Enter text"
    }
}

$enc = [System.Text.Encoding]::UTF8
$charBins = @()
$bitsAll = @()
foreach ($ch in $Text.ToCharArray()) {
    $bytes = $enc.GetBytes($ch)
    $bits = $bytes | ForEach-Object { [Convert]::ToString($_, 2).PadLeft(8, '0') }
    $bitsAll += $bits
    $charBins += ([string]::Join(' ', $bits))
}

$withSpaces = [string]::Join(' ', $charBins)
$compactStr = ($bitsAll -join '')

if ($Compact) {
    Write-Output $compactStr
} else {
    Write-Output $withSpaces
    Write-Output $compactStr
}
