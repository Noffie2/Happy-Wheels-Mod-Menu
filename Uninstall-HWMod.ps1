param([string]$GameDir = "")
$ErrorActionPreference='Stop'
function Add-Candidate([System.Collections.Generic.List[string]]$List,[string]$Path){if([string]::IsNullOrWhiteSpace($Path)){return};try{$f=[IO.Path]::GetFullPath($Path)}catch{return};if(-not $List.Contains($f)){$List.Add($f)}}
function Find-GameDirectory([string]$Explicit){
 $c=[System.Collections.Generic.List[string]]::new();Add-Candidate $c $Explicit;$p=$PSScriptRoot
 for($i=0;$i-lt 5 -and $p;$i++){Add-Candidate $c $p;$q=Split-Path -Parent $p;if($q-eq$p){break};$p=$q}
 Add-Candidate $c 'E:\Games\.Steam\steamapps\common\Happy Wheels'
 try{$steam=(Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath;if($steam){Add-Candidate $c (Join-Path $steam 'steamapps\common\Happy Wheels')}}catch{}
 foreach($d in $c){if(Test-Path -LiteralPath (Join-Path $d 'hwmod_backup')){return $d}};throw 'Could not find hwmod_backup.'
}
$GameDir=Find-GameDirectory $GameDir;$b=Join-Path $GameDir 'hwmod_backup'
$map=@(
 @((Join-Path $b 'Happy Wheels.exe.original'),(Join-Path $GameDir 'Happy Wheels.exe')),
 @((Join-Path $b 'app.asar.original'),(Join-Path $GameDir 'resources\app.asar')),
 @((Join-Path $b 'index.js.original'),(Join-Path $GameDir 'resources\webroot\js\index.js'))
)
foreach($pair in $map){if(Test-Path -LiteralPath $pair[0]){[IO.File]::Copy($pair[0],$pair[1],$true);Write-Host "Restored $($pair[1])" -ForegroundColor Green}}
Write-Host 'Happy Wheels mod removed. Clean backups were retained.' -ForegroundColor Green
