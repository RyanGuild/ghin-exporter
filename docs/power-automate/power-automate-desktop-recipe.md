# Fallback: Power Automate Desktop (no Automate tab)

**Prefer Excel Automate → Run** — see [`../power-automate-ghin.md`](../power-automate-ghin.md).  
Use this recipe **only** when Excel has no Automate tab (Office Scripts unavailable).

Power Automate Desktop is free with Windows 10/11. You do not need cloud Power Automate.

## What you need

- Windows 10 or 11
- [Power Automate Desktop](https://go.microsoft.com/fwlink/?linkid=2102613)
- Excel Desktop
- [`GhinPull-ToExcel.ps1`](GhinPull-ToExcel.ps1) in this folder

## Build the flow

1. **Power Automate Desktop** → **New flow** → name `GHIN Pull All Data`.
2. **Display input dialog** — email/GHIN → `%EmailOrGhin%`
3. **Display input dialog** — password (masked) → `%GhinPassword%`
4. **Display select dialog** — Include handicap history? Yes/No → `%IncludeHist%`
5. **Run PowerShell script** — call the `.ps1` (fix the path):

```powershell
$secure = ConvertTo-SecureString $GhinPassword -AsPlainText -Force
& "C:\Path\To\GhinPull-ToExcel.ps1" -EmailOrGhin $EmailOrGhin -Password $secure -IncludeHandicapHistory:($IncludeHist -eq "Yes")
```

6. Optional: open the newest file under `Documents\GHIN-Export`.
7. Save. Run from PAD when needed.

Or run the `.ps1` directly in PowerShell (it prompts):

```powershell
.\GhinPull-ToExcel.ps1 -IncludeHandicapHistory
```

## Notes

- Don’t hardcode the password in the flow.
- Output: CSV under Documents\GHIN-Export (and `.xlsx` if `ImportExcel` is installed).
- If Windows blocks the script: right-click → Properties → Unblock.
