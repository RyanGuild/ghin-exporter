<#
.SYNOPSIS
  Fallback GHIN full scorecard pull when Excel has no Automate tab.

.DESCRIPTION
  Prefer Excel Automate → GhinPullAllData → Run (see ../power-automate-ghin.md).
  This script is the Windows fallback only.

  Read-only. Prompts for email/GHIN and password (not echoed, not saved).
  Pages GET /scores.json until total_count, writes CSV (and .xlsx if ImportExcel
  is installed). Use in PowerShell or Power Automate Desktop "Run PowerShell script".

  Same API path as https://ryanguild.github.io/ghin-exporter/
#>
[CmdletBinding()]
param(
  [string]$EmailOrGhin,
  [SecureString]$Password,
  [string]$OutputFolder = (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "GHIN-Export"),
  [switch]$IncludeHandicapHistory,
  [int]$DelayMs = 750,
  [int]$PageSize = 50
)

$ErrorActionPreference = "Stop"
$ApiBase = "https://api2.ghin.com/api/v1"
$Source = "GHINcom"

function Write-Status([string]$Message) {
  Write-Host $Message
}

function Invoke-GhinJson {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    $Body = $null
  )
  $allHeaders = @{
    Accept = "application/json"
    "Content-Type" = "application/json"
    source = $Source
  }
  foreach ($key in $Headers.Keys) { $allHeaders[$key] = $Headers[$key] }

  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $allHeaders
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    throw "GHIN request failed ($Method $Url): $($_.Exception.Message)"
  }
}

if (-not $EmailOrGhin) {
  $EmailOrGhin = Read-Host "GHIN email or number"
}
if (-not $Password) {
  $Password = Read-Host "GHIN password" -AsSecureString
}
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
try {
  $PasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

New-Item -ItemType Directory -Force -Path $OutputFolder | Out-Null

try {
  Write-Status "Signing in to GHIN…"
  $login = Invoke-GhinJson -Method POST -Url "$ApiBase/golfer_login.json" -Body @{
    token = "nonblank"
    user = @{
      email_or_ghin = $EmailOrGhin
      password = $PasswordPlain
      remember_me = $true
    }
  }
  $user = $login.golfer_user
  $token = [string]$user.golfer_user_token
  if (-not $token) { throw "Login failed — check email/GHIN and password." }

  $golferId = $null
  foreach ($key in @("golfer_id", "ghin", "ghin_number", "id")) {
    if ($user.$key) { $golferId = [string]$user.$key; break }
  }
  if (-not $golferId -and $user.golfers -and $user.golfers.Count -gt 0) {
    $first = $user.golfers[0]
    foreach ($key in @("ghin", "ghin_number", "golfer_id", "id")) {
      if ($first.$key) { $golferId = [string]$first.$key; break }
    }
  }
  if (-not $golferId) { throw "Login succeeded but no golfer id was returned." }
  Write-Status "Signed in (GHIN $golferId)."

  $auth = @{ Authorization = "Bearer $token" }

  Start-Sleep -Milliseconds $DelayMs
  Write-Status "Loading profile…"
  $profileSearch = Invoke-GhinJson -Method GET `
    -Url "$ApiBase/golfers/search.json?golfer_id=$golferId&status=Active&per_page=10&page=1&source=$Source" `
    -Headers $auth
  $profile = if ($profileSearch.golfers) { $profileSearch.golfers[0] } else { @{ ghin = $golferId } }

  $merged = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  $offset = 0
  $totalCount = $null
  while ($true) {
    $label = if ($null -ne $totalCount) { "$($merged.Count)/$totalCount" } else { "$($merged.Count) so far" }
    Write-Status "Fetching scorecards… $label"
    Start-Sleep -Milliseconds $DelayMs
    $page = Invoke-GhinJson -Method GET `
      -Url "$ApiBase/scores.json?golfer_id=$golferId&source=$Source&limit=$PageSize&offset=$offset" `
      -Headers $auth
    if ($null -ne $page.total_count -and [string]$page.total_count -ne "-") {
      $totalCount = [int]$page.total_count
    }
    $batch = @($page.scores)
    foreach ($score in $batch) {
      $id = [string]$score.id
      if ($id -and $seen.ContainsKey($id)) { continue }
      if ($id) { $seen[$id] = $true }
      $merged.Add($score) | Out-Null
    }
    if ($batch.Count -eq 0) { break }
    if ($null -ne $totalCount -and $merged.Count -ge $totalCount) { break }
    if ($batch.Count -lt $PageSize) { break }
    $offset += $PageSize
    if ($offset -gt 5000) { break }
  }
  Write-Status "Fetched $($merged.Count) scorecards."

  $scoreRows = foreach ($s in ($merged | Sort-Object { [string]$_.played_at } -Descending)) {
    $holes = @($s.hole_details)
    [pscustomobject]@{
      score_id = $s.id
      played_at = ([string]$s.played_at).Substring(0, [Math]::Min(10, ([string]$s.played_at).Length))
      posted_at = if ($s.posted_at) { ([string]$s.posted_at).Substring(0, [Math]::Min(10, ([string]$s.posted_at).Length)) } else { "" }
      course_name = $s.course_name
      course_id = $s.course_id
      tee_set_name = $s.tee_set_rating_name
      holes = $s.number_of_holes
      holes_played = $s.number_of_played_holes
      adjusted_gross_score = $s.adjusted_gross_score
      course_rating = $s.course_rating
      slope_rating = $s.slope_rating
      differential = $s.differential
      unadjusted_differential = $s.unadjusted_differential
      score_type = $s.score_type_display_full
      score_type_short = $s.score_type_display_short
      status = $s.status
      used = $s.used
      exceptional = $s.exceptional
      is_manual = $s.is_manual
      front9_adjusted = $s.front9_adjusted
      back9_adjusted = $s.back9_adjusted
      gender = $s.gender
      golfer_id = $s.golfer_id
      hole_detail_count = $holes.Count
    }
  }

  $holeRows = foreach ($s in ($merged | Sort-Object { [string]$_.played_at } -Descending)) {
    $played = if ($s.played_at) { ([string]$s.played_at).Substring(0, [Math]::Min(10, ([string]$s.played_at).Length)) } else { "" }
    foreach ($h in (@($s.hole_details) | Sort-Object hole_number)) {
      [pscustomobject]@{
        score_id = $s.id
        played_at = $played
        course_name = $s.course_name
        hole_number = $h.hole_number
        par = $h.par
        raw_score = $h.raw_score
        adjusted_gross_score = $h.adjusted_gross_score
        stroke_allocation = $h.stroke_allocation
        putts = $h.putts
        fairway_hit = $h.fairway_hit
        gir_flag = $h.gir_flag
        drive_accuracy = $h.drive_accuracy
        approach_shot_accuracy = $h.approach_shot_accuracy
        x_hole = $h.x_hole
        most_likely_score = $h.most_likely_score
        hole_detail_id = $h.id
      }
    }
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmm"
  $scoresCsv = Join-Path $OutputFolder "ghin-scores-$stamp.csv"
  $holesCsv = Join-Path $OutputFolder "ghin-holes-$stamp.csv"
  $profileCsv = Join-Path $OutputFolder "ghin-profile-$stamp.csv"
  $scoreRows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $scoresCsv
  $holeRows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $holesCsv
  [pscustomobject]@{
    ghin = $profile.ghin
    player_name = $profile.player_name
    handicap_index = $profile.hi_display
    low_hi = $profile.low_hi
    club_name = $profile.club_name
    association_name = $profile.association_name
    state = $profile.state
    gender = $profile.gender
    status = $profile.status
  } | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $profileCsv

  $histCsv = $null
  if ($IncludeHandicapHistory) {
    Write-Status "Fetching handicap history…"
    Start-Sleep -Milliseconds $DelayMs
    $hist = Invoke-GhinJson -Method GET `
      -Url "$ApiBase/golfers/$golferId/handicap_history.json?rev_count=0&include_hidden=false&source=$Source" `
      -Headers $auth
    $revs = @()
    if ($hist.handicap_revisions) { $revs = @($hist.handicap_revisions) }
    elseif ($hist.revisions) { $revs = @($hist.revisions) }
    elseif ($hist.handicap_history) { $revs = @($hist.handicap_history) }
    $histCsv = Join-Path $OutputFolder "ghin-handicap-history-$stamp.csv"
    if ($revs.Count -eq 0) {
      [pscustomobject]@{ note = "No handicap history returned" } |
        Export-Csv -NoTypeInformation -Encoding UTF8 -Path $histCsv
    } else {
      $revs | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $histCsv
    }
  }

  $xlsx = Join-Path $OutputFolder "ghin-export-$stamp.xlsx"
  if (Get-Module -ListAvailable -Name ImportExcel) {
    Import-Module ImportExcel
    $scoreRows | Export-Excel -Path $xlsx -WorksheetName Scores -AutoSize -ClearSheet
    $holeRows | Export-Excel -Path $xlsx -WorksheetName Holes -AutoSize
    [pscustomobject]@{
      ghin = $profile.ghin
      player_name = $profile.player_name
      handicap_index = $profile.hi_display
      club_name = $profile.club_name
    } | Export-Excel -Path $xlsx -WorksheetName Profile -AutoSize
    if ($histCsv) {
      Import-Csv $histCsv | Export-Excel -Path $xlsx -WorksheetName HandicapHistory -AutoSize
    }
    Write-Status "Wrote $xlsx"
  } else {
    Write-Status "CSV written under $OutputFolder (install ImportExcel for .xlsx: Install-Module ImportExcel)"
  }

  Write-Status "Done: $($scoreRows.Count) rounds, $($holeRows.Count) holes."
  Write-Output @{
    OutputFolder = $OutputFolder
    ScoresCsv = $scoresCsv
    HolesCsv = $holesCsv
    ProfileCsv = $profileCsv
    HandicapCsv = $histCsv
    Xlsx = $(if (Test-Path $xlsx) { $xlsx } else { $null })
    RoundCount = $scoreRows.Count
    HoleCount = $holeRows.Count
  }
}
finally {
  $PasswordPlain = $null
  [GC]::Collect()
}
